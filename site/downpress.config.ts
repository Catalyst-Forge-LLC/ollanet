import { defineDownpressConfig } from 'downpress';

export default defineDownpressConfig({
	title: 'ollanet',
	description:
		'Chat with Ollama servers on any network you can reach — LAN, Tailscale, VPN, or a raw IP. Discover hosts, prompt models, continue chats by hash, and expose them to agents over MCP.',
	tagline: 'Find the models. Talk to them. Keep the thread.',
	lede: 'CLI · MCP · your network',
	url: 'https://ollanet.dev',
	author: 'Catalyst Forge LLC',
	logo: '/logo.png',
	homePage: 'about',
	topics: [
		{ label: 'Guides', tag: 'guides' },
		{ label: 'Release notes', tag: 'releases' },
		{ label: 'Agents', tag: 'agents' }
	],
	nav: [
		{ label: 'Home', href: '/' },
		{ label: 'Posts', href: '/writing' },
		{ label: 'Install', href: '/install' },
		{ label: 'GitHub', href: 'https://github.com/Catalyst-Forge-LLC/ollanet' }
	]
});
