# Icons

Concept demo. App names and logos belong to their owners. They appear only so people can tell which app a profile is about; it does not mean any of these companies works with or endorses totem.

`data/icons.json` is generated. Do not edit it by hand: change `icon` in `data/apps.json`, then run `node scripts/build-icons.mjs`.

## Sources

| Package | Version | License | sha512 | Used for |
|---|---|---|---|---|
| [simple-icons](https://simpleicons.org) | 16.35.0 | CC0-1.0 | `sha512-TCfl/2+GTrx0nCo4pEWGvxhOb8c6NsqOU1OpwjtF4lwJAthB8IYVD0fuIMjLMg6JFuG1YBO0t1iETQqJLqkoJA==` | 63 brand icons, as 24×24 path data |
| [@lobehub/icons-static-svg](https://lobehub.com/icons) | 1.96.0 | MIT | `sha512-BqfhytF77ecdG7y8zVbWR6WXsuUEP9zB5DTo5qeJPyH3wEwPXijpu/oPJSMfwCqt19OLLm+t5qXSrL3DVEikQg==` | 4 AI brand icons simple-icons does not carry, as sanitized SVG |

- simple-icons releases its collection under CC0-1.0 and asks users to read its DISCLAIMER: some icons carry their own license, the trademarks stay with their owners, and brand guidelines apply. Brands with published guidelines are linked below.
- None of the simple-icons in use has its own license entry in the package data. The DISCLAIMER says license data is still being added, so a missing entry does not mean an icon has no license of its own; the same goes for a missing guidelines link.
- Some well-known brands are not in simple-icons (Amazon, LinkedIn, Slack and OpenAI among them); simple-icons removes a brand when its owner asks. Those apps get a monogram tile, or a lobehub icon for AI brands.
- The lobehub package declares the MIT license in its package.json and README; the tarball has no LICENSE file, the text is at https://github.com/lobehub/lobe-icons/blob/master/LICENSE. The AI brands' marks stay with their owners. The lobehub SVGs are rebuilt through an allow-list (svg, title, g, path; presentation attributes only; no scripts, styles, links or url() references) before they are stored.
- The build checks each tarball against the pinned sha512 and license above and runs no code from either package.

## Icons in use

| Key | Title | Used by | Brand guidelines |
|---|---|---|---|
| `airbnb` | Airbnb | Airbnb |  |
| `alipay` | Alipay | Alipay | [link](https://global.alipay.com/docs/ac/website_hk/design) |
| `apple` | Apple | Apple Store |  |
| `bilibili` | Bilibili | Bilibili |  |
| `bookingdotcom` | Booking.com | Booking.com | [link](https://www.bookingholdings.com/media-room) |
| `calendly` | Calendly | Calendly | [link](https://calendly.com/newsroom) |
| `chase` | Chase | Chase |  |
| `claude` | Claude | Claude |  |
| `claudecode` | Claude Code | Claude Code |  |
| `coursera` | Coursera | Coursera |  |
| `cursor` | Cursor | Cursor |  |
| `dazhongdianping` | Dazhong Dianping | Dianping |  |
| `delta` | Delta | Delta Air Lines |  |
| `discord` | Discord | Discord | [link](https://discord.com/branding) |
| `doordash` | DoorDash | DoorDash |  |
| `duolingo` | Duolingo | Duolingo | [link](https://design.duolingo.com) |
| `etsy` | Etsy | Etsy |  |
| `expedia` | Expedia | Expedia | [link](https://brandfolder.com/portals/brand-expedia) |
| `gmail` | Gmail | Gmail |  |
| `googlegemini` | Google Gemini | Gemini |  |
| `googlemaps` | Google Maps | Google Maps |  |
| `greenhouse` | Greenhouse | Greenhouse | [link](https://brand.greenhouse.io/brand-portal/p/5) |
| `headspace` | Headspace | Headspace |  |
| `hellofresh` | HelloFresh | HelloFresh |  |
| `ikea` | IKEA | IKEA |  |
| `indeed` | Indeed | Indeed |  |
| `instacart` | Instacart | Instacart |  |
| `instagram` | Instagram | Instagram | [link](https://about.meta.com/brand/resources/instagram) |
| `khanacademy` | Khan Academy | Khan Academy | [link](https://support.khanacademy.org/hc/en-us/articles/202263034-Trademark-and-Brand-Usage-Policy) |
| `klook` | Klook | Klook |  |
| `leetcode` | LeetCode | LeetCode |  |
| `lyft` | Lyft | Lyft |  |
| `marriott` | Marriott | Marriott Bonvoy |  |
| `meetup` | Meetup | Meetup |  |
| `meituan` | Meituan | Meituan |  |
| `nextdoor` | Nextdoor | Nextdoor |  |
| `nike` | Nike | Nike |  |
| `notion` | Notion | Notion |  |
| `paypal` | PayPal | PayPal | [link](https://newsroom.paypal-corp.com/media-resources) |
| `peloton` | Peloton | Peloton |  |
| `perplexity` | Perplexity | Perplexity |  |
| `reddit` | Reddit | Reddit | [link](https://www.redditinc.com/brand) |
| `robinhood` | Robinhood | Robinhood |  |
| `starbucks` | Starbucks | Starbucks | [link](https://creative.starbucks.com) |
| `strava` | Strava | Strava |  |
| `taobao` | Taobao | Taobao |  |
| `target` | Target | Target |  |
| `tesla` | Tesla | Tesla |  |
| `thumbtack` | Thumbtack | Thumbtack |  |
| `tiktok` | TikTok | TikTok |  |
| `tripadvisor` | Tripadvisor | Tripadvisor | [link](https://tripadvisor.mediaroom.com/logo-guidelines) |
| `tripdotcom` | Trip.com | Trip.com |  |
| `uber` | Uber | Uber | [link](https://assets.uber.com/d/k4nuxdZ8MC7E/user-guide#/user-guide/terms-of-use) |
| `ubereats` | Uber Eats | Uber Eats | [link](https://assets.uber.com/d/k4nuxdZ8MC7E/user-guide#/user-guide/terms-of-use) |
| `udemy` | Udemy | Udemy | [link](https://support.udemy.com/hc/en-us/articles/8926753692567-Trademark-Usage-Guidelines) |
| `unitedairlines` | United Airlines | United Airlines |  |
| `venmo` | Venmo | Venmo | [link](https://venmo.com/about/brand) |
| `wechat` | WeChat | WeChat | [link](https://wechat.design/brand/main-brand) |
| `wise` | Wise | Wise | [link](https://wise.design/foundations/logo) |
| `xiaohongshu` | Xiaohongshu | Xiaohongshu |  |
| `yelp` | Yelp | Yelp | [link](https://www.yelp.com/brand) |
| `zillow` | Zillow | Zillow |  |
| `zoom` | Zoom | Zoom | [link](https://brand.zoom.us/usage-legal/) |
| `lobe:codex` | Codex | Codex | |
| `lobe:doubao` | Doubao | Doubao | |
| `lobe:manus` | Manus | Manus | |
| `lobe:openai` | OpenAI | ChatGPT | |

## Monogram tiles

These have `icon: null` and show their `mono` letters on `color`. Government forms never get seals or emblems.

- Not in simple-icons 16.35.0: KAYAK (K), TripIt (TI), OpenTable (OT), Amazon (a), Costco (C), JD.com (JD), Sephora (S), Chewy (C), DiDi (D), Waymo (W), Hertz (H), LinkedIn (in), Slack (S), BOSS Zhipin (B), Zocdoc (Z), CVS Pharmacy (Rx), MyFitnessPal (M), Oura (O), Apartments.com (A), Taskrabbit (T), Rover (R), TurboTax (TT), Hinge (H)
- Generic agents: New coding agent (Dv), Personal agent (PA), Support bot (CS)
- Forms: Car insurance quote (CI), US visa DS-160 (US), US ESTA (US), US passport renewal (DS-82) (US), DMV REAL ID (ID), Schengen visa (EU), UK Standard Visitor visa (UK), Japan eVISA (JP), Visit Japan Web (JP), China visa (COVA) (CN), Canada eTA (CA), Job application (CV), New hire paperwork (HR), New patient intake (Dr), Rental application (RA), Bank account application (BK), School enrollment (SE), College application (Ed)
