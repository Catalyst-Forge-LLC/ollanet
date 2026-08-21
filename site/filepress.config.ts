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
	footerLinks: [
		{ label: 'GitHub', href: 'https://github.com/Catalyst-Forge-LLC/ollanet', icon: 'github' },
		{ label: 'AppFacts', href: 'https://appfacts.dev/v#af1.eNpVkU9LAzEQxb9KeCeF2OI1NymolepFbyKSZqe7sdkkZCbVpfS7S6r1z2nCzLx5P1722MFcakQ7EgxSCDaSQEOm3BqL1VJJSgEaLFYqw8A68TuCRvCOIre1--XT14bbwuwRbOyr7dvkacr06IrPotWd3dmvNzRKjeKPpg-po9kbQ2NILD72zTek2m2CLYSDRkeZYZ73iDAQ_oBGhgF9kKtNoH5d1MYHYvXuZUhVlEtj9sGKTxEH_X1gysQnjPyPUZ3IFdecUxEcXjR4537c_4BpFJgTs9qkorrk6khRjn6KvdBRv64-dC2XbN3W9vQ62mh7auoc89jSJpZG1oqG8zC48XJb1-rKtVusznJdB8_DbBrDecukUE7sJZWpQYhkNvN572Wo65lL43xhxYaJ5eI6lZ4uVqvF_PS7h0996atz' },
		{ label: 'ToolFacts', href: 'https://toolfacts.dev/v#tf1.eNrFlstuUzEQhl_F8gqkXAqLLtJVVcQqQNWwq6rKtSc5Vn052OOEKOq78_vkBHoJ0KKi7CJ7Lv83M2fijVzKybuBDMqTnMjonArE4tPZuZhRWlKSA2loSS62-D2RZ4qVW2cWH2NaEC5hkm0MuDoaHY-OcZJZcck4UJrtsto4qynkGv-0Vbqh4fvREY5vbTA487od5l2uVALbKmUj6TvpwtvYLmrlhm2KmnKGGScVchsT4y6zsVHeDaROZAjuyuXqn-hbsTiSk8sr3NIiVV9cMDnyxGkN5xADdYiZbVA1W-7tOcYa53LzqDbXyVdIa-ia5nPSXFGrfyo73kSgrJnm1lFGtcj_SoUQq5hucVBCqm5WM0QOZE9HiDcHAkEDkvg2MqD6M1iV1Maulhfk45KEEj4acmKeohcqiC-Q6ZVoYmYU5Yl6ZPEtPyVYJcu_1541-m9eU_2MgoH2rRzB8ZF0EZPQEc0MpSJmtSQjdKP4RHi1Fm2dOlh1c6CTRYhuRNx6H7NGDpXo8NAXJQhuCDieduhqoWwAii-Obeuow8_jrqkZVTEiEZcUUIUth834JPZ1tjj3UsTXnslzaBBvTFwFF5V5-3M40Ul0GCQenn8b0axVeAoCAPO_OPDtPsD4YNF7LCTRZVM37oHmbVdcN38N2bRlzCcitnWBKCemp5_FV6zQjmQfYRNXhyWcQUHfG6xCZbDWn71B8mGlT2vh-89Dl5Rg5NaizhtWRAzPIKitu67L5KUkezZCD_cvDP3Gurfc7u2zvE_4gra6DyYbRUaJ6c_Sxc1aWCPvrgayiZ5atai-DXObJ-NxzzLCq6ITjNCWY_dnvDNZWG7KzQjrbrx7bwy798ZwOj3bBeheASVoVYeoU3r3Azp1G68' }
	],
	paths: [{ url: '/docs', dir: 'docs/dist' }]
});
