import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class CreatomateApi implements ICredentialType {
	name = 'creatomateApi';

	displayName = 'Creatomate API';

	// Same icon for both themes
	icon: Icon = 'file:../icons/creatomate.svg';

	documentationUrl = 'https://creatomate.com/docs/api/reference/where-can-i-find-my-api-key';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'The API key of the Creatomate project you want to use. Find it in your dashboard under Project Settings > API Key.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	// Any authenticated endpoint works; this one is cheap
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.creatomate.com',
			url: '/v1/projects/data',
		},
	};
}
