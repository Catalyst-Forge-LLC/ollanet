import { defineFilepressConfig } from 'getfilepress';

export default defineFilepressConfig({
	title: 'ollanet',
	description:
		'CLI for humans, MCP for agents, Node for apps. Talk to Ollama on any host you can reach.',
	tagline: 'Talk to Ollama on any host you can reach.',
	lede: 'CLI for humans · MCP for agents · Node for apps',
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
		{ label: 'Docs', href: '/docs' },
		{ label: 'Posts', href: '/writing' },
		{ label: 'Install', href: '/install' },
		{ label: 'GitHub', href: 'https://github.com/Catalyst-Forge-LLC/ollanet', icon: 'github' }
	],
	paths: [{ url: '/docs', dir: 'docs/dist' }]
});
