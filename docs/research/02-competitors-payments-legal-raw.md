# Raw research — competitors, payments, legal (2026-10-07)

> Caveat: page fetches were blocked by the proxy; findings come from search snippets. Items marked **[UNVERIFIED]** need manual checks.

## 1. Tunisian competitors
**No structured, paid, Tunisia-specific prep product** was found for security/customs/admin/teacher/bank concours. The space is: free announcement portals, Facebook pages, forums, generic French QCM apps.

| Name | Type | Offer | Weakness |
|---|---|---|---|
| [tunisieconcours.tn](https://tunisieconcours.tn/) | Aggregator | job/concours news | no prep |
| [kedma.tn](https://www.kedma.tn/) | Aggregator (AR) | announcements + static QCM posts ([example](https://www.kedma.tn/2023/02/affaires-etrangeres-QCM.html)) | no scoring/progress |
| concourstunisie.tn/.com, concours.com.tn, emploi.rn.tn, tunisien.tn, [orientini.com](https://www.orientini.com/) | Aggregators | announcements; Orientini advertises paid courses (mostly CAPA/agrégation) | SEO competition, no prep |
| "Concours En Tunisie 2023" (Play) | Listing app | listings | stale |
| "Qcm Police Nationale" etc. (Play) | QCM apps | French police content | not Tunisian syllabus |
| Clic To Know (iOS) | Tunisian app | accounting/law QCM, bar exam papers | out of our scope; proves local QCM app viable |
| FB "مناظرات و إنتدابات" (@concours.gouv.tn) | FB page | reposts announcements | alerts only |
| WhatsApp "Tunisi-E-mploi" | Channel | alerts | alerts only |
| [tunisia-sat forum](https://www.tunisia-sat.com/forums/threads/3159633/) | Forum | candidates begging for QCM links | **unmet demand signal** |
| Private centres (IPSI? Tunis/Sfax/Sousse) | Offline | ENA prep 12–24 months [UNVERIFIED] | expensive, offline |
| TakiAcademy, MyPrepa, edusoutien (state) | Adjacent edtech | school support | potential entrants |

Signal: religious questions in an Interior Ministry QCM caused public controversy ([babnet](https://www.babnet.net/rttdetail-63906.asp)) — content-sensitivity risk.

## 2. Comparables
| Product | Price | Model |
|---|---|---|
| Testbook (India) | ₹1,499/yr list, promos ₹299–349 | 150k+ mocks, AI doubt support, ~39M users |
| Adda247 (India) | ₹399–999 per exam-family pass | test-series subscription |
| superConcours (FR) | €4.99/wk, €9.99/mo, €24.99/quarter | 12 concours, 1,500 quiz, past papers |
| Foucher "Réussite Concours" (FR) | €19.90–21.90 book + app | hybrid book-app |
| مسار التحصيلي (KSA) | SAR 24.99/mo | prep app |
| Morocco dreamjob.ma | free (ads) | past papers; no prep app found |
| Algeria | free news portals | 22,186 police posts 2025, no prep app found |

## 3. Payments (solo founder in Tunisia)
| Option | Fees | Requirements | Notes |
|---|---|---|---|
| **Konnect** | ~1.3–1.6% TN cards & e-Dinar; ~2.9–3.3% intl cards | freelancers/SMEs; docs [UNVERIFIED] | BCT payment-facilitator licence (Dec 2023); accepts card, Flouci, wallet, e-Dinar; payment links via SMS/WhatsApp ([LaunchBase](https://launchbaseafrica.com/2024/12/17/tunisias-konnect-networks-raises-1-5m-to-simplify-online-transactions-for-businesses), [Managers](https://managers.tn/2023/12/07/konnect-lagrement-de-la-banque-centrale-en-poche)) |
| **Flouci** | 1.3% HT, no setup fee | auto-entrepreneur, sole proprietor, SUARL, SARL, SA; RNE upload → sandbox ([docs](https://docs.flouci.com/getting-started/create-an-account)) | licensed facilitator |
| ClicToPay (SMT) | not public | bank affiliation contract | large merchants |
| Paymee | — | — | assets frozen 2023; status unclear |
| D17 / e-Dinar | — | via Konnect | 500k D17 subscribers |
| Carrier billing | — | via aggregators (TPAY/Mondia) | [UNVERIFIED] for small SaaS |
| Stripe | ✗ for TN residents | US LLC workaround | — |
| Polar.sh | 4% + 40¢ (+0.5% subs) | lists Tunisia as payout country | best intl option found ([docs](https://polar.sh/docs/merchant-of-record/supported-countries)) |
| Paddle | — | Tunisia not on sanctions list [UNVERIFIED] | — |
| Lemon Squeezy | — | Tunisia not confirmed | — |

- New **BCT circular 2026-10** (25 Sep 2026) replaces 2018-16 for payment institutions, effective 3 months after publication. [Managers](https://managers.tn/2026/09/26/nouvelle-circulaire-de-la-bct-voici-ce-qui-change-pour-les-etablissements-de-paiement/)
- **Auto-entrepreneur** (DL 2020-33): turnover ≤ 75,000 TND/yr; eligible activity list fixed by decree (edtech eligibility [UNVERIFIED]).
- **Startup Act label**: foreign-currency account, carte technologique 100k TND.

## 4. Legal
- **Loi organique 2004-63** (data protection): prior declaration to INPDP; prior **authorisation** for sensitive data and **transfers abroad** ⇒ foreign cloud hosting needs INPDP authorisation. [DLA Piper](https://www.dlapiperdataprotection.com/?t=law&c=TN)
- Reform bill (132 → 123 articles) in ARP committee hearings (May 2026); **no plenary vote found**. Claims it is in force are unreliable.
- **Convention 108**: party since 1 Nov 2017; signed 108+ in 2019 (ratification status [UNVERIFIED]). [CoE](https://www.coe.int/en/web/data-protection/-/tunisia-30th-country-to-sign-convention-108-)
- **Copyright Loi 94-36 (mod. 2009-33)**: official legislative/administrative/judicial texts are **excluded** from protection ([WIPO Lex](https://www.wipo.int/wipolex/fr/legislation/details/21148)). Whether past exam papers count as "administrative texts" is **unsettled → legal review**. Third-party compilations (books, kedma.tn, apps) are protected.
- **Loi 2000-83** (e-commerce): art. 25 pre-contract info; art. 29 receipt within 10 days; **art. 30 withdrawal right 10 working days** (exceptions for started digital services [UNVERIFIED]). [CMF text](https://www.cmf.tn/sites/default/files/pdfs/reglementation/textes-reference/loi_2000-83_090800_fr.pdf)
- concours.gov.tn terms of use: not found.
