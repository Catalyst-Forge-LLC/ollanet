import { defineFilepressConfig } from 'getfilepress';

export default defineFilepressConfig({
	title: 'ollanet',
	description:
		'Find, manage, and use Ollama models on the hosts you choose. CLI, MCP, and Node library.',
	tagline: 'The models on your machines, from one place.',
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
		{ label: 'See the rest of the Catalyst Forge shelf.', href: 'https://catalystforge.com/tools/' },
		{ label: 'GitHub', href: 'https://github.com/Catalyst-Forge-LLC/ollanet', icon: 'github' },
		{ label: 'AppFacts', href: 'https://appfacts.dev/v#af1.eNpVkUFPGzEQhf-K9U5FMom4-oYitaUKXOCGEHK8k10Xrz3aGS-sovz3yglp6cmWZ957n54PmOFuLLIfCQ4lJZ9JYaELt4fN9s5oKQkWol6rwMEHjTPBIsVAWdra_d3TeSO8wR2QfO6r79vkaWF6DFNkteaXn_35DoupZo2n0IfS0eq3wGIoojH3LTeV2u2TnwhHi45Y4J4PyHBQ-YAFw4E-KNQmMP9SzD4mEvMedShVTSgjx-Q1loyj_TRYmOSCwf8xmgu5kcpcJsXxxULm8Df9C5jFBHdhNvsyma6EOlLWU56RqHTS72pMXeuFfXjzPb2OPvuempozj61tEm1k7bAIEQ4_ov6sO3MbmpeYb1x3KcqwWsZ01ToZykh87nhQZXHr9efvrTqaGxxxkahlWr6s9FGHuluFMq43Xn1aRK-_l6mn6-12czHA8Q84xbbO' },
		{ label: 'ToolFacts', href: 'https://toolfacts.dev/v#tf1.eNrFlstuUzEQhl_F8gqkXAqLLtJVVcQqQNWwq6rKtSc5Vn052OOEKOq78_vkBHoJ0KKi7CJ7Lv83M2fijVzKybuBDMqTnMjonArE4tPZuZhRWlKSA2loSS62-D2RZ4qVW2cWH2NaEC5hkm0MuDoaHY-OcZJZcck4UJrtsto4qynkGv-0Vbqh4fvREY5vbTA487od5l2uVALbKmUj6TvpwtvYLmrlhm2KmnKGGScVchsT4y6zsVHeDaROZAjuyuXqn-hbsTiSk8sr3NIiVV9cMDnyxGkN5xADdYiZbVA1W-7tOcYa53LzqDbXyVdIa-ia5nPSXFGrfyo73kSgrJnm1lFGtcj_SoUQq5hucVBCqm5WM0QOZE9HiDcHAkEDkvg2MqD6M1iV1Maulhfk45KEEj4acmKeohcqiC-Q6ZVoYmYU5Yl6ZPEtPyVYJcu_1541-m9eU_2MgoH2rRzB8ZF0EZPQEc0MpSJmtSQjdKP4RHi1Fm2dOlh1c6CTRYhuRNx6H7NGDpXo8NAXJQhuCDieduhqoWwAii-Obeuow8_jrqkZVTEiEZcUUIUth834JPZ1tjj3UsTXnslzaBBvTFwFF5V5-3M40Ul0GCQenn8b0axVeAoCAPO_OPDtPsD4YNF7LCTRZVM37oHmbVdcN38N2bRlzCcitnWBKCemp5_FV6zQjmQfYRNXhyWcQUHfG6xCZbDWn71B8mGlT2vh-89Dl5Rg5NaizhtWRAzPIKitu67L5KUkezZCD_cvDP3Gurfc7u2zvE_4gra6DyYbRUaJ6c_Sxc1aWCPvrgayiZ5atai-DXObJ-NxzzLCq6ITjNCWY_dnvDNZWG7KzQjrbrx7bwy798ZwOj3bBeheASVoVYeoU3r3Azp1G68' }
	],
	paths: [{ url: '/docs', dir: 'docs/dist' }]
});
