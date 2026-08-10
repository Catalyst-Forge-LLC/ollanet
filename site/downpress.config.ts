import { defineDownpressConfig } from 'downpress';

export default defineDownpressConfig({
	title: 'ollanet',
	description:
		'Chat with Ollama servers on any network you can reach — LAN, Tailscale, VPN, or a raw IP. Discover hosts, prompt models, continue chats by hash, and expose them to agents over MCP.',
	tagline: 'Ollama over your network.',
	lede: 'Discover hosts. Prompt models. Hand agents the mesh.',
	url: 'https://ollanet.dev',
	author: 'Catalyst Forge LLC',
	logo: '/logo.png',
	topics: [
		{ label: 'Guides', tag: 'guides' },
		{ label: 'Release notes', tag: 'releases' },
		{ label: 'Agents', tag: 'agents' }
	],
	nav: [
		{ label: 'Posts', href: '/' },
		{ label: 'Install', href: '/install' },
		{ label: 'About', href: '/about' },
		{ label: 'GitHub', href: 'https://github.com/Catalyst-Forge-LLC/ollanet' }
	]
});
