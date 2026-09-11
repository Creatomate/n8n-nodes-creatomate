import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeListSearchResult,
	INodeType,
	INodeTypeDescription,
	JsonObject,
	ResourceMapperField,
	ResourceMapperFields,
} from 'n8n-workflow';
import {
	jsonParse,
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	sleep,
} from 'n8n-workflow';

const BASE_URL = 'https://api.creatomate.com';

async function creatomateApiRequest(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	endpoint: string,
	body?: IDataObject,
): Promise<unknown> {
	const response = (await this.helpers.httpRequestWithAuthentication.call(this, 'creatomateApi', {
		method,
		url: `${BASE_URL}${endpoint}`,
		// Identifies renders made through this node in the project's API log
		headers: { 'User-Agent': 'Creatomate-n8n-Node' },
		body,
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	})) as { statusCode: number; body: unknown };

	if (response.statusCode >= 400) {
		// Surface the API's hint and docs link instead of n8n's generic HTTP error
		const errorBody = (response.body ?? {}) as IDataObject;
		throw new NodeApiError(this.getNode(), errorBody as JsonObject, {
			httpCode: String(response.statusCode),
			// A 401 means the stored key was rotated or its project deleted, so point at the credential
			message:
				response.statusCode === 401
					? 'The API key in this credential was rejected by Creatomate. It may have been rotated, or its project deleted. Open the credential and paste the current key from Project Settings > API Key.'
					: typeof errorBody.hint === 'string'
						? errorBody.hint
						: `Creatomate returned an error (HTTP ${response.statusCode})`,
			description:
				typeof errorBody.documentation === 'string' ? `See ${errorBody.documentation}` : undefined,
		});
	}

	return response.body;
}

export class Creatomate implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Creatomate',
		name: 'creatomate',
		// Same icon for both themes; the logo colours do not change between them
		icon: 'file:../../icons/creatomate.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Generate videos and images with Creatomate',
		defaults: {
			name: 'Creatomate',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'creatomateApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Render',
						value: 'render',
					},
					{
						name: 'Template',
						value: 'template',
					},
				],
				default: 'render',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['render'],
					},
				},
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Render a video or image',
						action: 'Create a render',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get the status and result of a render',
						action: 'Get a render',
					},
				],
				default: 'create',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['template'],
					},
				},
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Create a new template',
						action: 'Create a template',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Permanently delete a template',
						action: 'Delete a template',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a template, including its source',
						action: 'Get a template',
					},
					{
						name: 'Get Many',
						value: 'getMany',
						description: 'List the templates in the project',
						action: 'Get many templates',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Change the name, tags, or source of a template',
						action: 'Update a template',
					},
				],
				default: 'create',
			},
			{
				displayName: 'Render From',
				name: 'renderFrom',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['render'],
						operation: ['create'],
					},
				},
				options: [
					{
						name: 'JSON (RenderScript)',
						value: 'renderScript',
						description: 'Describe the video or image in JSON, without using a template',
					},
					{
						name: 'Template',
						value: 'template',
						description: 'Use a template from your Creatomate project',
					},
				],
				default: 'template',
			},
			{
				displayName: 'Template',
				name: 'templateId',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				displayOptions: {
					show: {
						resource: ['render'],
						operation: ['create'],
						renderFrom: ['template'],
					},
				},
				description: 'The template to render',
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						typeOptions: {
							searchListMethod: 'searchTemplates',
							searchable: true,
						},
					},
					{
						displayName: 'By ID',
						name: 'id',
						type: 'string',
						placeholder: 'e.g. 4b6e8f42-c58a-4c2f-9e2f-2b4e6a7f9c31',
						validation: [
							{
								type: 'regex',
								properties: {
									regex:
										'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
									errorMessage: 'The template ID must be a UUID',
								},
							},
						],
					},
				],
			},
			{
				displayName: 'Modifications',
				name: 'modifications',
				type: 'resourceMapper',
				noDataExpression: true,
				default: {
					mappingMode: 'defineBelow',
					value: null,
				},
				displayOptions: {
					show: {
						resource: ['render'],
						operation: ['create'],
						renderFrom: ['template'],
						// n8n reports an empty field list as an error, and it is empty until a template
						// is picked
						templateId: [{ _cnd: { exists: true } }],
					},
				},
				typeOptions: {
					loadOptionsDependsOn: ['templateId.value'],
					resourceMapper: {
						resourceMapperMethod: 'getTemplateModificationFields',
						mode: 'add',
						fieldWords: {
							singular: 'modification',
							plural: 'modifications',
						},
						// Only consulted when false, which would hide every non-required field
						addAllFields: true,
						// A template gains and loses dynamic elements, so reload rather than keep a stale list
						refreshStaleSchemaOnOpen: true,
						// A template with no dynamic elements is not an error; the API returns its own notice
						hideNoDataError: true,
						multiKeyMatch: false,
						supportAutoMap: true,
					},
				},
			},
			{
				displayName: 'RenderScript',
				name: 'renderScript',
				type: 'json',
				default: '{\n  "output_format": "mp4",\n  "elements": []\n}',
				required: true,
				displayOptions: {
					show: {
						resource: ['render'],
						operation: ['create'],
						renderFrom: ['renderScript'],
					},
				},
				description:
					'The video or image to render, in Creatomate\'s RenderScript format. See <a href="https://creatomate.com/docs/api/render-script/introduction">the documentation</a>.',
			},
			{
				displayName: 'Wait for Completion',
				name: 'waitForCompletion',
				type: 'boolean',
				default: true,
				displayOptions: {
					show: {
						resource: ['render'],
						operation: ['create'],
					},
				},
				description:
					'Whether to wait for the render to finish. When turned off, the node returns immediately and the render URL is not available yet.',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: {
					show: {
						resource: ['render'],
						operation: ['create'],
					},
				},
				options: [
					{
						displayName: 'Additional Modifications',
						name: 'additionalModifications',
						type: 'fixedCollection',
						placeholder: 'Add modification',
						default: {},
						typeOptions: {
							multipleValues: true,
						},
						description:
							'Change any property of any element, including elements that are not marked as dynamic',
						options: [
							{
								displayName: 'Modification',
								name: 'modification',
								values: [
									{
										displayName: 'Selector',
										name: 'selector',
										type: 'string',
										default: '',
										placeholder: 'e.g. Text-1.fill_color',
										description:
											'The element name, optionally followed by the property to change',
									},
									{
										displayName: 'Value',
										name: 'value',
										type: 'string',
										default: '',
									},
								],
							},
						],
					},
					{
						displayName: 'Max Height',
						name: 'maxHeight',
						type: 'number',
						default: 1920,
						description: 'Scale the output down so that it does not exceed this height in pixels',
					},
					{
						displayName: 'Max Wait Time (Seconds)',
						name: 'maxWaitTime',
						type: 'number',
						// Long videos can take hours to render
						default: 10800,
						typeOptions: {
							minValue: 1,
						},
						displayOptions: {
							show: {
								'/waitForCompletion': [true],
							},
						},
						description:
							'How long to wait for the render to finish before failing the node. The render itself keeps running and can be fetched later with the Get operation.',
					},
					{
						displayName: 'Max Width',
						name: 'maxWidth',
						type: 'number',
						default: 1920,
						description: 'Scale the output down so that it does not exceed this width in pixels',
					},
					{
						displayName: 'Metadata',
						name: 'metadata',
						type: 'string',
						default: '',
						description:
							'Any data you want to store with the render, returned as-is and sent along to webhooks',
					},
					{
						displayName: 'Render Scale',
						name: 'renderScale',
						type: 'number',
						default: 1,
						typeOptions: {
							minValue: 0,
						},
						description: 'Scale the output relative to the template size, where 1 is 100%',
					},
					{
						displayName: 'Webhook URL',
						name: 'webhookUrl',
						type: 'string',
						default: '',
						description: 'A URL that Creatomate calls once the render has finished',
					},
				],
			},
			{
				displayName: 'Render ID',
				name: 'renderId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['render'],
						operation: ['get'],
					},
				},
				description: 'The ID of the render to look up',
			},
			{
				displayName: 'Template',
				name: 'templateId',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				displayOptions: {
					show: {
						resource: ['template'],
						operation: ['delete', 'get', 'update'],
					},
				},
				description: 'The template to get, update, or delete',
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						typeOptions: {
							searchListMethod: 'searchTemplates',
							searchable: true,
						},
					},
					{
						displayName: 'By ID',
						name: 'id',
						type: 'string',
						placeholder: 'e.g. 4b6e8f42-c58a-4c2f-9e2f-2b4e6a7f9c31',
						validation: [
							{
								type: 'regex',
								properties: {
									regex:
										'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
									errorMessage: 'The template ID must be a UUID',
								},
							},
						],
					},
				],
			},
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['template'],
						operation: ['create'],
					},
				},
				description: 'The name of the new template',
			},
			{
				displayName: 'Source',
				name: 'source',
				type: 'json',
				default: '{\n  "output_format": "mp4",\n  "elements": []\n}',
				required: true,
				displayOptions: {
					show: {
						resource: ['template'],
						operation: ['create'],
					},
				},
				description:
					'The design of the template, in Creatomate\'s RenderScript format. See <a href="https://creatomate.com/docs/api/render-script/introduction">the documentation</a>.',
			},
			{
				displayName: 'Tags',
				name: 'tags',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['template'],
						operation: ['create'],
					},
				},
				description: 'Comma-separated list of tags to assign to the template',
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						resource: ['template'],
						operation: ['getMany'],
					},
				},
				description: 'Whether to return all results or only up to a given limit',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: {
					minValue: 1,
				},
				displayOptions: {
					show: {
						resource: ['template'],
						operation: ['getMany'],
						returnAll: [false],
					},
				},
				description: 'Max number of results to return',
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add filter',
				default: {},
				displayOptions: {
					show: {
						resource: ['template'],
						operation: ['getMany'],
					},
				},
				options: [
					{
						displayName: 'Tags',
						name: 'tags',
						type: 'string',
						default: '',
						description:
							'Comma-separated list of tags. Only templates carrying at least one of these tags are returned.',
					},
				],
			},
			{
				displayName: 'Update Fields',
				name: 'updateFields',
				type: 'collection',
				placeholder: 'Add field',
				default: {},
				displayOptions: {
					show: {
						resource: ['template'],
						operation: ['update'],
					},
				},
				options: [
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: '',
						description: 'A new name for the template',
					},
					{
						displayName: 'Source',
						name: 'source',
						type: 'json',
						default: '',
						description:
							'A new design for the template, in Creatomate\'s RenderScript format. Replaces the entire source.',
					},
					{
						displayName: 'Tags',
						name: 'tags',
						type: 'string',
						default: '',
						description:
							'Comma-separated list of tags, replacing the current tags. Leave empty to remove all tags.',
					},
				],
			},
		],
	};

	methods = {
		listSearch: {
			async searchTemplates(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const templates = (await creatomateApiRequest.call(this, 'GET', '/v2/templates')) as Array<{
					id: string;
					name?: string;
				}>;

				// The API has no search parameter, so the filter is applied here
				const query = filter?.toLowerCase();

				return {
					results: templates
						.map((template) => ({
							name: template.name?.trim() ? template.name : 'Untitled template',
							value: template.id,
						}))
						.filter((template) => !query || template.name.toLowerCase().includes(query)),
				};
			},
		},
		resourceMapping: {
			async getTemplateModificationFields(
				this: ILoadOptionsFunctions,
			): Promise<ResourceMapperFields> {
				const templateId = this.getNodeParameter('templateId', undefined, {
					extractValue: true,
				}) as string;

				// n8n asks for the fields before a template has been picked
				if (!templateId) {
					return { fields: [] };
				}

				// The API returns n8n's ResourceMapperFields shape, so labels can change server-side
				// without a release
				return (await creatomateApiRequest.call(
					this,
					'GET',
					`/v1/internal/n8n/fields?template-id=${templateId}`,
				)) as ResourceMapperFields;
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const resource = this.getNodeParameter('resource', itemIndex) as string;
				const operation = this.getNodeParameter('operation', itemIndex) as string;

				if (resource === 'template') {
					if (operation === 'create') {
						const rawSource = this.getNodeParameter('source', itemIndex) as string | IDataObject;

						const body: IDataObject = {
							name: this.getNodeParameter('name', itemIndex) as string,
							source:
								typeof rawSource === 'string'
									? jsonParse<IDataObject>(rawSource, {
											errorMessage: 'The template source is not valid JSON',
										})
									: rawSource,
						};

						const tags = (this.getNodeParameter('tags', itemIndex, '') as string)
							.split(',')
							.map((tag) => tag.trim())
							.filter((tag) => tag.length > 0);

						if (tags.length > 0) {
							body.tags = tags;
						}

						const template = (await creatomateApiRequest.call(
							this,
							'POST',
							'/v2/templates',
							body,
						)) as IDataObject;

						returnData.push({ json: template, pairedItem: { item: itemIndex } });
					} else if (operation === 'getMany') {
						const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;

						const tags = ((filters.tags as string) ?? '')
							.split(',')
							.map((tag) => tag.trim())
							.filter((tag) => tag.length > 0);

						const templates = (await creatomateApiRequest.call(
							this,
							'GET',
							tags.length > 0
								? `/v2/templates?tags=${encodeURIComponent(tags.join(','))}`
								: '/v2/templates',
						)) as IDataObject[];

						// The API answers with every template at once, so the limit is applied here
						const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;

						for (const template of returnAll
							? templates
							: templates.slice(0, this.getNodeParameter('limit', itemIndex, 50) as number)) {
							returnData.push({ json: template, pairedItem: { item: itemIndex } });
						}
					} else if (operation === 'update') {
						const templateId = this.getNodeParameter('templateId', itemIndex, undefined, {
							extractValue: true,
						}) as string;

						const updateFields = this.getNodeParameter('updateFields', itemIndex, {}) as IDataObject;

						const body: IDataObject = {};

						if (updateFields.name !== undefined) {
							body.name = updateFields.name;
						}

						if (updateFields.source !== undefined) {
							body.source =
								typeof updateFields.source === 'string'
									? jsonParse<IDataObject>(updateFields.source, {
											errorMessage: 'The template source is not valid JSON',
										})
									: updateFields.source;
						}

						if (updateFields.tags !== undefined) {
							body.tags = (updateFields.tags as string)
								.split(',')
								.map((tag) => tag.trim())
								.filter((tag) => tag.length > 0);
						}

						if (Object.keys(body).length === 0) {
							throw new NodeOperationError(
								this.getNode(),
								'Add at least one field to update (Name, Source, or Tags)',
								{ itemIndex },
							);
						}

						const template = (await creatomateApiRequest.call(
							this,
							'PATCH',
							`/v2/templates/${templateId}`,
							body,
						)) as IDataObject;

						returnData.push({ json: template, pairedItem: { item: itemIndex } });
					} else if (operation === 'delete') {
						const templateId = this.getNodeParameter('templateId', itemIndex, undefined, {
							extractValue: true,
						}) as string;

						// The API answers a deletion with 204 and no body
						await creatomateApiRequest.call(this, 'DELETE', `/v2/templates/${templateId}`);

						returnData.push({ json: { id: templateId, deleted: true }, pairedItem: { item: itemIndex } });
					} else {
						const templateId = this.getNodeParameter('templateId', itemIndex, undefined, {
							extractValue: true,
						}) as string;

						const template = (await creatomateApiRequest.call(
							this,
							'GET',
							`/v2/templates/${templateId}`,
						)) as IDataObject;

						returnData.push({ json: template, pairedItem: { item: itemIndex } });
					}

					continue;
				}

				let render: IDataObject;

				if (operation === 'create') {
					const renderFrom = this.getNodeParameter('renderFrom', itemIndex) as string;
					const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

					const waitForCompletion = this.getNodeParameter('waitForCompletion', itemIndex) as boolean;
					const maxWaitTime = Number(options.maxWaitTime ?? 10800);

					if (waitForCompletion && (!Number.isFinite(maxWaitTime) || maxWaitTime < 1)) {
						throw new NodeOperationError(
							this.getNode(),
							`"Max Wait Time" must be a number of seconds, at least 1, but it was ${JSON.stringify(options.maxWaitTime)}`,
							{
								itemIndex,
								description:
									'To start a render without waiting for it, turn off "Wait for Completion" instead.',
							},
						);
					}

					const body: IDataObject = {};
					const modifications: IDataObject = {};

					if (renderFrom === 'template') {
						body.template_id = this.getNodeParameter('templateId', itemIndex, undefined, {
							extractValue: true,
						}) as string;

						const mappingMode = this.getNodeParameter(
							'modifications.mappingMode',
							itemIndex,
							'defineBelow',
						) as string;

						if (mappingMode === 'autoMapInputData') {
							// Only keys the template knows are passed on; input rows carry unrelated columns
							const schema = this.getNodeParameter(
								'modifications.schema',
								itemIndex,
								[],
							) as ResourceMapperField[];

							for (const field of schema) {
								if (Object.prototype.hasOwnProperty.call(items[itemIndex].json, field.id)) {
									modifications[field.id] = items[itemIndex].json[field.id];
								}
							}
						} else {
							// Blank means "leave as designed", so empty values are not sent
							const mappedValues = this.getNodeParameter(
								'modifications.value',
								itemIndex,
								{},
							) as IDataObject;

							for (const [selector, value] of Object.entries(mappedValues)) {
								if (value !== null && value !== undefined && value !== '') {
									modifications[selector] = value;
								}
							}
						}
					} else {
						const renderScript = this.getNodeParameter('renderScript', itemIndex) as
							| string
							| IDataObject;

						const source =
							typeof renderScript === 'string'
								? jsonParse<IDataObject>(renderScript, {
										errorMessage: 'The RenderScript is not valid JSON',
									})
								: renderScript;

						// A RenderScript is the request body itself. Any "modifications" key in it is replaced below
						Object.assign(body, source);
					}

					// fixedCollection values are nested one level, and blank rows are skipped
					const additionalModifications = (options.additionalModifications as IDataObject)
						?.modification as Array<{ selector: string; value: string }> | undefined;

					for (const { selector, value } of additionalModifications ?? []) {
						if (selector) {
							modifications[selector] = value;
						}
					}

					if (Object.keys(modifications).length > 0) {
						body.modifications = modifications;
					}

					// Numbers are checked against undefined (a render scale of 0 is valid), strings against
					// emptiness
					if (options.renderScale !== undefined) {
						body.render_scale = options.renderScale;
					}

					if (options.maxWidth !== undefined) {
						body.max_width = options.maxWidth;
					}

					if (options.maxHeight !== undefined) {
						body.max_height = options.maxHeight;
					}

					if (options.metadata) {
						body.metadata = options.metadata;
					}

					if (options.webhookUrl) {
						body.webhook_url = options.webhookUrl;
					}

					render = (await creatomateApiRequest.call(this, 'POST', '/v2/renders', body)) as IDataObject;

					if (waitForCompletion) {
						const deadline = Date.now() + maxWaitTime * 1000;

						// Only the create response carries validation errors and warnings, so they are reattached
						// to the polled result
						const { errors, warnings } = render;
						const renderId = String(render.id);
						// Starts short so quick renders are picked up promptly, then backs off to keep
						// long waits cheap and clear of the rate limit
						let pollInterval = 3000;
						let lastPollError: NodeApiError | undefined;

						while (!['succeeded', 'failed', 'cancelled'].includes(render.status as string)) {
							if (Date.now() >= deadline) {
								// If the polls themselves were failing, report the API error rather than a timeout
								if (lastPollError !== undefined) {
									throw new NodeOperationError(
										this.getNode(),
										`The render could not be checked for ${maxWaitTime} seconds: ${lastPollError.message}`,
										{
											itemIndex,
											description: `Render ${renderId} was started and may well have finished. Fetch it with the Get operation once the API is reachable again.`,
										},
									);
								}

								throw new NodeOperationError(
									this.getNode(),
									`The render did not finish within ${maxWaitTime} seconds`,
									{
										itemIndex,
										description: `Render ${renderId} is still running. Raise "Max Wait Time", or turn off "Wait for Completion" and fetch the result later with the Get operation.`,
									},
								);
							}

							// Do not sleep past the deadline
							await sleep(Math.min(pollInterval, deadline - Date.now()));
							pollInterval = Math.min(pollInterval * 1.5, 15000);

							try {
								render = (await creatomateApiRequest.call(
									this,
									'GET',
									`/v2/renders/${renderId}`,
								)) as IDataObject;
								lastPollError = undefined;
							} catch (error) {
								// Rate limits and transient errors are waited out; the render keeps running regardless.
								// Other 4xx errors are definitive (a 404 means the render no longer exists) and end the wait
								const apiError = error as NodeApiError;
								const httpCode = Number(apiError.httpCode);
								if (httpCode >= 400 && httpCode < 500 && httpCode !== 429) {
									throw apiError;
								}
								lastPollError = apiError;
							}
						}

						if (errors !== undefined) {
							render.errors = errors;
						}

						if (warnings !== undefined) {
							render.warnings = warnings;
						}

						if (render.status !== 'succeeded') {
							throw new NodeOperationError(
								this.getNode(),
								`The render ${render.status as string}: ${(render.error_message as string) ?? 'no error message was given'}`,
								{
									itemIndex,
									description: [
										...(Array.isArray(errors) ? (errors as string[]) : []),
										'The API Log in your Creatomate dashboard shows the full request and error',
									].join(' · '),
								},
							);
						}
					}
				} else {
					const renderId = this.getNodeParameter('renderId', itemIndex) as string;

					render = (await creatomateApiRequest.call(
						this,
						'GET',
						`/v2/renders/${renderId}`,
					)) as IDataObject;
				}

				returnData.push({
					json: render,
					pairedItem: { item: itemIndex },
				});
			} catch (error) {
				// API and wait-loop errors already carry a message and description; anything else is
				// wrapped so n8n keeps the item index
				const nodeError =
					error instanceof NodeApiError || error instanceof NodeOperationError
						? error
						: new NodeOperationError(this.getNode(), error as Error, { itemIndex });

				// continueOnFail() is true for both "continue" modes. The error field is what routes an item
				// to the Error output; without it n8n only recognises json holding nothing but an error
				if (this.continueOnFail()) {
					returnData.push({
						json: { ...items[itemIndex].json, error: nodeError.message },
						error: nodeError,
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				throw nodeError;
			}
		}

		return [returnData];
	}
}
