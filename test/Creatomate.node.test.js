const test = require('node:test');
const assert = require('node:assert/strict');

const { Creatomate } = require('../dist/nodes/Creatomate/Creatomate.node.js');

const node = new Creatomate();

// Stands in for n8n's execution context: parameters come from a map, and every HTTP call is
// answered from a queue of canned responses so the whole flow can be exercised offline. The
// wait loop sleeps for real, so the polling tests take a few seconds each
function makeContext({ params, items = [{ json: {} }], responses }) {
	const calls = [];

	return {
		calls,
		context: {
			getInputData: () => items,
			continueOnFail: () => false,
			getNode: () => ({ name: 'Creatomate', type: 'creatomate', typeVersion: 1 }),
			getNodeParameter(name, _itemIndex, fallback) {
				if (name in params) {
					return params[name];
				}
				if (fallback !== undefined) {
					return fallback;
				}
				throw new Error(`Missing test parameter: ${name}`);
			},
			helpers: {
				httpRequestWithAuthentication: {
					call: async (_context, credentialName, options) => {
						calls.push({ credentialName, options });

						const response = responses.shift();
						if (!response) {
							throw new Error(`Unexpected request: ${options.method ?? 'GET'} ${options.url}`);
						}

						return response;
					},
				},
			},
		},
	};
}

const templateParams = {
	resource: 'render',
	operation: 'create',
	renderFrom: 'template',
	templateId: 'tmpl-1',
	'modifications.mappingMode': 'defineBelow',
	'modifications.value': {},
	waitForCompletion: true,
	options: {},
};

test('the modification mapper reloads when another template is picked', () => {
	const modifications = node.description.properties.find((property) => property.name === 'modifications');

	assert.deepEqual(modifications.typeOptions.loadOptionsDependsOn, ['templateId.value']);
	assert.equal(
		modifications.typeOptions.resourceMapper.resourceMapperMethod,
		'getTemplateModificationFields',
	);
});

test('a template render waits for the finished file', async () => {
	const { context, calls } = makeContext({
		params: {
			...templateParams,
			'modifications.value': { 'Text-1.text': 'Hello' },
			options: { renderScale: 0.5, metadata: 'order-42' },
		},
		responses: [
			{ statusCode: 202, body: { id: 'render-1', status: 'planned' } },
			{
				statusCode: 200,
				body: {
					id: 'render-1',
					status: 'succeeded',
					url: 'https://cdn.creatomate.com/renders/render-1.mp4',
				},
			},
		],
	});

	const result = await node.execute.call(context);

	assert.equal(calls[0].options.url, 'https://api.creatomate.com/v2/renders');
	assert.equal(calls[0].options.headers['User-Agent'], 'Creatomate-n8n-Node');
	assert.deepEqual(calls[0].options.body, {
		template_id: 'tmpl-1',
		modifications: { 'Text-1.text': 'Hello' },
		render_scale: 0.5,
		metadata: 'order-42',
	});
	assert.equal(calls[1].options.url, 'https://api.creatomate.com/v2/renders/render-1');
	assert.equal(result[0][0].json.url, 'https://cdn.creatomate.com/renders/render-1.mp4');
	assert.deepEqual(result[0][0].pairedItem, { item: 0 });
});

test('automatic mapping only passes on keys the template knows', async () => {
	const { context, calls } = makeContext({
		items: [{ json: { 'Text-1.text': 'From sheet', unrelated: 'ignored' } }],
		params: {
			...templateParams,
			'modifications.mappingMode': 'autoMapInputData',
			'modifications.schema': [{ id: 'Text-1.text' }, { id: 'Image-1.source' }],
			waitForCompletion: false,
		},
		responses: [{ statusCode: 202, body: { id: 'render-2', status: 'planned' } }],
	});

	const result = await node.execute.call(context);

	assert.deepEqual(calls[0].options.body.modifications, { 'Text-1.text': 'From sheet' });
	assert.equal(calls.length, 1, 'the render should not be polled when not waiting');
	assert.equal(result[0][0].json.status, 'planned');
});

// An element can be named anything, including after a member of Object.prototype, which an
// `in` check would match on a row that never carried that key
test('automatic mapping ignores prototype members the row does not carry', async () => {
	const { context, calls } = makeContext({
		items: [{ json: { 'Text-1.text': 'From sheet' } }],
		params: {
			...templateParams,
			'modifications.mappingMode': 'autoMapInputData',
			'modifications.schema': [
				{ id: 'Text-1.text' },
				{ id: 'constructor' },
				{ id: 'toString' },
				{ id: 'valueOf' },
			],
			waitForCompletion: false,
		},
		responses: [{ statusCode: 202, body: { id: 'render-2b', status: 'planned' } }],
	});

	await node.execute.call(context);

	assert.deepEqual(calls[0].options.body.modifications, { 'Text-1.text': 'From sheet' });
});

test('a RenderScript is sent as the render itself, extra modifications alongside it', async () => {
	const { context, calls } = makeContext({
		params: {
			resource: 'render',
			operation: 'create',
			renderFrom: 'renderScript',
			renderScript: '{"output_format":"mp4","elements":[{"type":"text","text":"Hi"}]}',
			waitForCompletion: false,
			options: {
				additionalModifications: {
					modification: [{ selector: 'Text-1.fill_color', value: '#ff0000' }],
				},
				webhookUrl: 'https://example.com/hook',
			},
		},
		responses: [{ statusCode: 202, body: { id: 'render-3', status: 'planned' } }],
	});

	await node.execute.call(context);

	const body = calls[0].options.body;
	assert.equal(body.output_format, 'mp4');
	assert.equal(body.elements.length, 1);
	assert.deepEqual(body.modifications, { 'Text-1.fill_color': '#ff0000' });
	assert.equal(body.webhook_url, 'https://example.com/hook');
});

test("the API's own hint becomes the error message", async () => {
	const { context } = makeContext({
		params: { resource: 'render', operation: 'get', renderId: 'render-4' },
		responses: [
			{
				statusCode: 400,
				body: {
					hint: "The parameter 'template_id' should be a valid template ID.",
					documentation: 'https://creatomate.com/docs',
				},
			},
		],
	});

	await assert.rejects(node.execute.call(context), {
		message: "The parameter 'template_id' should be a valid template ID.",
	});
});

test('a failed render fails the node', async () => {
	const { context } = makeContext({
		params: templateParams,
		responses: [
			{
				statusCode: 202,
				body: { id: 'render-5', status: 'failed', error_message: 'A file could not be downloaded' },
			},
		],
	});

	await assert.rejects(node.execute.call(context), /A file could not be downloaded/);
});

test('waiting too long points back at the running render', async () => {
	const { context } = makeContext({
		params: { ...templateParams, options: { maxWaitTime: 1 } },
		responses: [
			{ statusCode: 202, body: { id: 'render-6', status: 'rendering' } },
			{ statusCode: 200, body: { id: 'render-6', status: 'rendering' } },
		],
	});

	await assert.rejects(node.execute.call(context), (error) => {
		assert.match(error.message, /did not finish within 1 seconds/);
		assert.match(error.description, /render-6/);
		return true;
	});
});

// A wait shorter than a second cannot poll, and a non-numeric one would leave the deadline NaN,
// which removes both the timeout and the backoff. Both are refused before a render is spent
test('a max wait time below one is refused without creating a render', async () => {
	const { context, calls } = makeContext({
		params: { ...templateParams, options: { maxWaitTime: 0 } },
		responses: [],
	});

	await assert.rejects(node.execute.call(context), (error) => {
		assert.match(error.message, /"Max Wait Time" must be a number of seconds, at least 1/);
		assert.match(error.description, /Wait for Completion/);
		return true;
	});

	assert.equal(calls.length, 0, 'nothing should be sent when the wait time is invalid');
});

test('a non-numeric max wait time is refused without creating a render', async () => {
	const { context, calls } = makeContext({
		params: { ...templateParams, options: { maxWaitTime: 'soon' } },
		responses: [],
	});

	await assert.rejects(node.execute.call(context), /"Max Wait Time" must be a number of seconds/);

	assert.equal(calls.length, 0, 'nothing should be sent when the wait time is invalid');
});

test('an invalid max wait time is ignored when not waiting', async () => {
	const { context, calls } = makeContext({
		params: { ...templateParams, waitForCompletion: false, options: { maxWaitTime: 0 } },
		responses: [{ statusCode: 202, body: { id: 'render-6b', status: 'planned' } }],
	});

	const result = await node.execute.call(context);

	assert.equal(result[0][0].json.status, 'planned');
	assert.equal(calls.length, 1, 'the render should still be created');
});

// Failing polls leave the render status unknown, which the timeout message has to distinguish
// from a slow render
test('a wait that runs out while the polls are failing reports the API error', async () => {
	const { context } = makeContext({
		params: { ...templateParams, options: { maxWaitTime: 1 } },
		responses: [
			{ statusCode: 202, body: { id: 'render-13', status: 'planned' } },
			{ statusCode: 503, body: { hint: 'The service is temporarily unavailable.' } },
		],
	});

	await assert.rejects(node.execute.call(context), (error) => {
		assert.match(error.message, /could not be checked for 1 seconds/);
		assert.match(error.message, /temporarily unavailable/);
		assert.match(error.description, /render-13/);
		return true;
	});
});

test('an invalid API key points at the credential instead of repeating the API', async () => {
	const { context } = makeContext({
		params: { resource: 'render', operation: 'get', renderId: 'render-4' },
		responses: [{ statusCode: 401, body: { hint: 'The provided API key is invalid.' } }],
	});

	await assert.rejects(node.execute.call(context), /Open the credential and paste the current key/);
});

// The error field is what routes an item to the Error output
test('continue on fail marks the item as an error, alongside the input item', async () => {
	const { context } = makeContext({
		items: [{ json: { orderId: 42 } }],
		params: { resource: 'render', operation: 'get', renderId: 'render-7' },
		responses: [{ statusCode: 404, body: { hint: 'The requested render does not exist.' } }],
	});
	context.continueOnFail = () => true;

	const result = await node.execute.call(context);

	assert.deepEqual(result[0][0].json, {
		orderId: 42,
		error: 'The requested render does not exist.',
	});
	assert.equal(result[0][0].error.message, 'The requested render does not exist.');
	assert.equal(result[0][0].error.httpCode, '404');
});

test('continue on fail keeps the good renders and marks only the failed one', async () => {
	const { context } = makeContext({
		items: [{ json: { n: 1 } }, { json: { n: 2 } }, { json: { n: 3 } }],
		params: templateParams,
		responses: [
			{ statusCode: 202, body: { id: 'render-8', status: 'succeeded', url: 'https://cdn/8.mp4' } },
			{ statusCode: 202, body: { id: 'render-9', status: 'failed', error_message: 'Font not found' } },
			{ statusCode: 202, body: { id: 'render-10', status: 'succeeded', url: 'https://cdn/10.mp4' } },
		],
	});
	context.continueOnFail = () => true;

	const result = await node.execute.call(context);

	assert.equal(result[0].length, 3);
	assert.equal(result[0][0].error, undefined);
	assert.match(result[0][1].error.message, /Font not found/);
	assert.equal(result[0][1].pairedItem.item, 1);
	assert.equal(result[0][2].error, undefined);
});

// The API allows 30 requests per 10 seconds per key, and answers a breach with plain text rather
// than the usual JSON error body
test('a rate-limited poll is waited out instead of losing the render', async () => {
	const { context, calls } = makeContext({
		params: templateParams,
		responses: [
			{ statusCode: 202, body: { id: 'render-8', status: 'planned' } },
			{ statusCode: 429, body: 'Too Many Requests' },
			{
				statusCode: 200,
				body: {
					id: 'render-8',
					status: 'succeeded',
					url: 'https://cdn.creatomate.com/renders/render-8.mp4',
				},
			},
		],
	});

	const result = await node.execute.call(context);

	assert.equal(calls.length, 3, 'the poll should have been retried');
	assert.equal(result[0][0].json.url, 'https://cdn.creatomate.com/renders/render-8.mp4');
});

test('a poll that cannot succeed ends the wait', async () => {
	const { context } = makeContext({
		params: templateParams,
		responses: [
			{ statusCode: 202, body: { id: 'render-9', status: 'planned' } },
			{ statusCode: 401, body: { hint: 'The API key is not valid.' } },
		],
	});

	await assert.rejects(node.execute.call(context), /Open the credential and paste the current key/);
});

test('validation findings from the create response survive the wait', async () => {
	const { context } = makeContext({
		params: templateParams,
		responses: [
			{
				statusCode: 202,
				body: {
					id: 'render-10',
					status: 'planned',
					warnings: ["Modification 'Text-2' matched no element"],
				},
			},
			{ statusCode: 200, body: { id: 'render-10', status: 'succeeded', url: 'https://x/y.mp4' } },
		],
	});

	const result = await node.execute.call(context);

	assert.deepEqual(result[0][0].json.warnings, ["Modification 'Text-2' matched no element"]);
});

test('a failed render reports the validation errors that predicted it', async () => {
	const { context } = makeContext({
		params: templateParams,
		responses: [
			{
				statusCode: 202,
				body: { id: 'render-11', status: 'planned', errors: ['The element has no source'] },
			},
			{
				statusCode: 200,
				body: { id: 'render-11', status: 'failed', error_message: 'Nothing to render' },
			},
		],
	});

	await assert.rejects(node.execute.call(context), (error) => {
		assert.match(error.description, /The element has no source/);
		return true;
	});
});

// Fields the user did not fill in must not blank their elements
test('modifications left blank are not sent', async () => {
	const { context, calls } = makeContext({
		params: {
			...templateParams,
			'modifications.value': {
				'Text-1.text': 'Hello',
				'Text-2.text': null,
				'Image-1.source': '',
				'Text-3.text': 0,
			},
			waitForCompletion: false,
		},
		responses: [{ statusCode: 202, body: { id: 'render-14', status: 'planned' } }],
	});

	await node.execute.call(context);

	assert.deepEqual(calls[0].options.body.modifications, {
		'Text-1.text': 'Hello',
		'Text-3.text': 0,
	});
});

test('a render with nothing filled in sends no modifications at all', async () => {
	const { context, calls } = makeContext({
		params: {
			...templateParams,
			'modifications.value': { 'Text-1.text': null, 'Text-2.text': '' },
			waitForCompletion: false,
		},
		responses: [{ statusCode: 202, body: { id: 'render-15', status: 'planned' } }],
	});

	await node.execute.call(context);

	assert.deepEqual(calls[0].options.body, { template_id: 'tmpl-1' });
});

test('the modification fields arrive shown, so nothing has to be added by hand', async () => {
	const { context } = makeContext({
		params: { templateId: 'tmpl-1' },
		responses: [
			{
				statusCode: 200,
				body: {
					fields: [{ id: 'Text-1.text', displayName: 'Text-1', removed: false, readOnly: false }],
				},
			},
		],
	});

	const result = await node.methods.resourceMapping.getTemplateModificationFields.call(context);

	assert.equal(result.fields[0].removed, false);
	assert.equal(result.fields[0].readOnly, false);
});

test('the modifications field stays hidden until a template is picked', () => {
	const modifications = node.description.properties.find((property) => property.name === 'modifications');

	assert.deepEqual(modifications.displayOptions.show.templateId, [{ _cnd: { exists: true } }]);
	assert.equal(modifications.typeOptions.resourceMapper.hideNoDataError, true);
	assert.equal(modifications.typeOptions.resourceMapper.refreshStaleSchemaOnOpen, true);
});

test('the template list is searchable', async () => {
	const { context, calls } = makeContext({
		params: {},
		responses: [
			{
				statusCode: 200,
				body: [
					{ id: 'a', name: 'Promo' },
					{ id: 'b', name: '' },
					{ id: 'c', name: 'Story' },
				],
			},
		],
	});

	const list = await node.methods.listSearch.searchTemplates.call(context, 'pro');

	assert.equal(calls[0].options.url, 'https://api.creatomate.com/v2/templates');
	assert.deepEqual(list.results, [{ name: 'Promo', value: 'a' }]);
});

test('the modification fields come from the template', async () => {
	const { context, calls } = makeContext({
		params: { templateId: 'tmpl-1' },
		responses: [
			{ statusCode: 200, body: { fields: [{ id: 'Text-1.text', displayName: 'Text-1' }] } },
		],
	});

	const fields = await node.methods.resourceMapping.getTemplateModificationFields.call(context);

	assert.equal(
		calls[0].options.url,
		'https://api.creatomate.com/v1/internal/n8n/fields?template-id=tmpl-1',
	);
	assert.equal(fields.fields[0].id, 'Text-1.text');
});

test('a template is created from name, source, and tags', async () => {
	const { context, calls } = makeContext({
		params: {
			resource: 'template',
			operation: 'create',
			name: 'Promo',
			source: '{"output_format":"mp4","elements":[]}',
			tags: 'social, promo',
		},
		responses: [{ statusCode: 201, body: { id: 'tmpl-9', name: 'Promo' } }],
	});

	const result = await node.execute.call(context);

	assert.equal(calls[0].options.method, 'POST');
	assert.equal(calls[0].options.url, 'https://api.creatomate.com/v2/templates');
	assert.deepEqual(calls[0].options.body, {
		name: 'Promo',
		source: { output_format: 'mp4', elements: [] },
		tags: ['social', 'promo'],
	});
	assert.equal(result[0][0].json.id, 'tmpl-9');
	assert.deepEqual(result[0][0].pairedItem, { item: 0 });
});

test('get many templates emits one item per template and filters by tags', async () => {
	const { context, calls } = makeContext({
		params: {
			resource: 'template',
			operation: 'getMany',
			filters: { tags: 'social, promo' },
		},
		responses: [
			{
				statusCode: 200,
				body: [
					{ id: 'a', name: 'Promo' },
					{ id: 'b', name: 'Story' },
				],
			},
		],
	});

	const result = await node.execute.call(context);

	assert.equal(calls[0].options.url, 'https://api.creatomate.com/v2/templates?tags=social%2Cpromo');
	assert.equal(result[0].length, 2);
	assert.equal(result[0][1].json.id, 'b');
	assert.deepEqual(result[0][1].pairedItem, { item: 0 });
});

// The API has no pagination of its own, so the limit is applied to the full list it returns
test('get many templates stops at the limit unless everything is asked for', async () => {
	const listOfThree = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

	const limited = makeContext({
		params: { resource: 'template', operation: 'getMany', returnAll: false, limit: 2 },
		responses: [{ statusCode: 200, body: listOfThree }],
	});

	assert.equal((await node.execute.call(limited.context))[0].length, 2);

	const all = makeContext({
		params: { resource: 'template', operation: 'getMany', returnAll: true },
		responses: [{ statusCode: 200, body: listOfThree }],
	});

	assert.equal((await node.execute.call(all.context))[0].length, 3);
});

test('getting a template returns its source', async () => {
	const { context, calls } = makeContext({
		params: { resource: 'template', operation: 'get', templateId: 'tmpl-1' },
		responses: [
			{ statusCode: 200, body: { id: 'tmpl-1', name: 'Promo', source: { elements: [] } } },
		],
	});

	const result = await node.execute.call(context);

	assert.equal(calls[0].options.url, 'https://api.creatomate.com/v2/templates/tmpl-1');
	assert.deepEqual(result[0][0].json.source, { elements: [] });
});

test('an update sends only the fields that were set', async () => {
	const { context, calls } = makeContext({
		params: {
			resource: 'template',
			operation: 'update',
			templateId: 'tmpl-1',
			updateFields: { name: 'Renamed' },
		},
		responses: [{ statusCode: 200, body: { id: 'tmpl-1', name: 'Renamed' } }],
	});

	await node.execute.call(context);

	assert.equal(calls[0].options.method, 'PATCH');
	assert.equal(calls[0].options.url, 'https://api.creatomate.com/v2/templates/tmpl-1');
	assert.deepEqual(calls[0].options.body, { name: 'Renamed' });
});

test('an update with nothing to change fails before calling the API', async () => {
	const { context, calls } = makeContext({
		params: {
			resource: 'template',
			operation: 'update',
			templateId: 'tmpl-1',
			updateFields: {},
		},
		responses: [],
	});

	await assert.rejects(node.execute.call(context), /at least one field/);
	assert.equal(calls.length, 0);
});

test('deleting a template reports the deleted ID', async () => {
	const { context, calls } = makeContext({
		params: { resource: 'template', operation: 'delete', templateId: 'tmpl-1' },
		responses: [{ statusCode: 204, body: undefined }],
	});

	const result = await node.execute.call(context);

	assert.equal(calls[0].options.method, 'DELETE');
	assert.equal(calls[0].options.url, 'https://api.creatomate.com/v2/templates/tmpl-1');
	assert.deepEqual(result[0][0].json, { id: 'tmpl-1', deleted: true });
});
