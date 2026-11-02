/**
 * ISO 3166-1 countries, verbatim from https://www.iban.com/country-codes
 * (249 entries, fetched 2026-11-02). Names keep the ISO short form, e.g.
 * "United States of America (the)"; ALIASES below add the names people type.
 */
export interface Country {
  /** ISO 3166-1 alpha-2, what we store. */
  code: string;
  name: string;
  alpha3: string;
  numeric: string;
}

export const COUNTRIES: Country[] = [
  { code: "AF", name: "Afghanistan", alpha3: "AFG", numeric: "004" },
  { code: "AX", name: "Åland Islands", alpha3: "ALA", numeric: "248" },
  { code: "AL", name: "Albania", alpha3: "ALB", numeric: "008" },
  { code: "DZ", name: "Algeria", alpha3: "DZA", numeric: "012" },
  { code: "AS", name: "American Samoa", alpha3: "ASM", numeric: "016" },
  { code: "AD", name: "Andorra", alpha3: "AND", numeric: "020" },
  { code: "AO", name: "Angola", alpha3: "AGO", numeric: "024" },
  { code: "AI", name: "Anguilla", alpha3: "AIA", numeric: "660" },
  { code: "AQ", name: "Antarctica", alpha3: "ATA", numeric: "010" },
  { code: "AG", name: "Antigua and Barbuda", alpha3: "ATG", numeric: "028" },
  { code: "AR", name: "Argentina", alpha3: "ARG", numeric: "032" },
  { code: "AM", name: "Armenia", alpha3: "ARM", numeric: "051" },
  { code: "AW", name: "Aruba", alpha3: "ABW", numeric: "533" },
  { code: "AU", name: "Australia", alpha3: "AUS", numeric: "036" },
  { code: "AT", name: "Austria", alpha3: "AUT", numeric: "040" },
  { code: "AZ", name: "Azerbaijan", alpha3: "AZE", numeric: "031" },
  { code: "BS", name: "Bahamas (the)", alpha3: "BHS", numeric: "044" },
  { code: "BH", name: "Bahrain", alpha3: "BHR", numeric: "048" },
  { code: "BD", name: "Bangladesh", alpha3: "BGD", numeric: "050" },
  { code: "BB", name: "Barbados", alpha3: "BRB", numeric: "052" },
  { code: "BY", name: "Belarus", alpha3: "BLR", numeric: "112" },
  { code: "BE", name: "Belgium", alpha3: "BEL", numeric: "056" },
  { code: "BZ", name: "Belize", alpha3: "BLZ", numeric: "084" },
  { code: "BJ", name: "Benin", alpha3: "BEN", numeric: "204" },
  { code: "BM", name: "Bermuda", alpha3: "BMU", numeric: "060" },
  { code: "BT", name: "Bhutan", alpha3: "BTN", numeric: "064" },
  { code: "BO", name: "Bolivia (Plurinational State of)", alpha3: "BOL", numeric: "068" },
  { code: "BQ", name: "Bonaire, Sint Eustatius and Saba", alpha3: "BES", numeric: "535" },
  { code: "BA", name: "Bosnia and Herzegovina", alpha3: "BIH", numeric: "070" },
  { code: "BW", name: "Botswana", alpha3: "BWA", numeric: "072" },
  { code: "BV", name: "Bouvet Island", alpha3: "BVT", numeric: "074" },
  { code: "BR", name: "Brazil", alpha3: "BRA", numeric: "076" },
  { code: "IO", name: "British Indian Ocean Territory (the)", alpha3: "IOT", numeric: "086" },
  { code: "BN", name: "Brunei Darussalam", alpha3: "BRN", numeric: "096" },
  { code: "BG", name: "Bulgaria", alpha3: "BGR", numeric: "100" },
  { code: "BF", name: "Burkina Faso", alpha3: "BFA", numeric: "854" },
  { code: "BI", name: "Burundi", alpha3: "BDI", numeric: "108" },
  { code: "CV", name: "Cabo Verde", alpha3: "CPV", numeric: "132" },
  { code: "KH", name: "Cambodia", alpha3: "KHM", numeric: "116" },
  { code: "CM", name: "Cameroon", alpha3: "CMR", numeric: "120" },
  { code: "CA", name: "Canada", alpha3: "CAN", numeric: "124" },
  { code: "KY", name: "Cayman Islands (the)", alpha3: "CYM", numeric: "136" },
  { code: "CF", name: "Central African Republic (the)", alpha3: "CAF", numeric: "140" },
  { code: "TD", name: "Chad", alpha3: "TCD", numeric: "148" },
  { code: "CL", name: "Chile", alpha3: "CHL", numeric: "152" },
  { code: "CN", name: "China", alpha3: "CHN", numeric: "156" },
  { code: "CX", name: "Christmas Island", alpha3: "CXR", numeric: "162" },
  { code: "CC", name: "Cocos (Keeling) Islands (the)", alpha3: "CCK", numeric: "166" },
  { code: "CO", name: "Colombia", alpha3: "COL", numeric: "170" },
  { code: "KM", name: "Comoros (the)", alpha3: "COM", numeric: "174" },
  { code: "CD", name: "Congo (the Democratic Republic of the)", alpha3: "COD", numeric: "180" },
  { code: "CG", name: "Congo (the)", alpha3: "COG", numeric: "178" },
  { code: "CK", name: "Cook Islands (the)", alpha3: "COK", numeric: "184" },
  { code: "CR", name: "Costa Rica", alpha3: "CRI", numeric: "188" },
  { code: "CI", name: "Côte d'Ivoire", alpha3: "CIV", numeric: "384" },
  { code: "HR", name: "Croatia", alpha3: "HRV", numeric: "191" },
  { code: "CU", name: "Cuba", alpha3: "CUB", numeric: "192" },
  { code: "CW", name: "Curaçao", alpha3: "CUW", numeric: "531" },
  { code: "CY", name: "Cyprus", alpha3: "CYP", numeric: "196" },
  { code: "CZ", name: "Czechia", alpha3: "CZE", numeric: "203" },
  { code: "DK", name: "Denmark", alpha3: "DNK", numeric: "208" },
  { code: "DJ", name: "Djibouti", alpha3: "DJI", numeric: "262" },
  { code: "DM", name: "Dominica", alpha3: "DMA", numeric: "212" },
  { code: "DO", name: "Dominican Republic (the)", alpha3: "DOM", numeric: "214" },
  { code: "EC", name: "Ecuador", alpha3: "ECU", numeric: "218" },
  { code: "EG", name: "Egypt", alpha3: "EGY", numeric: "818" },
  { code: "SV", name: "El Salvador", alpha3: "SLV", numeric: "222" },
  { code: "GQ", name: "Equatorial Guinea", alpha3: "GNQ", numeric: "226" },
  { code: "ER", name: "Eritrea", alpha3: "ERI", numeric: "232" },
  { code: "EE", name: "Estonia", alpha3: "EST", numeric: "233" },
  { code: "SZ", name: "Eswatini", alpha3: "SWZ", numeric: "748" },
  { code: "ET", name: "Ethiopia", alpha3: "ETH", numeric: "231" },
  { code: "FK", name: "Falkland Islands (the) [Malvinas]", alpha3: "FLK", numeric: "238" },
  { code: "FO", name: "Faroe Islands (the)", alpha3: "FRO", numeric: "234" },
  { code: "FJ", name: "Fiji", alpha3: "FJI", numeric: "242" },
  { code: "FI", name: "Finland", alpha3: "FIN", numeric: "246" },
  { code: "FR", name: "France", alpha3: "FRA", numeric: "250" },
  { code: "GF", name: "French Guiana", alpha3: "GUF", numeric: "254" },
  { code: "PF", name: "French Polynesia", alpha3: "PYF", numeric: "258" },
  { code: "TF", name: "French Southern Territories (the)", alpha3: "ATF", numeric: "260" },
  { code: "GA", name: "Gabon", alpha3: "GAB", numeric: "266" },
  { code: "GM", name: "Gambia (the)", alpha3: "GMB", numeric: "270" },
  { code: "GE", name: "Georgia", alpha3: "GEO", numeric: "268" },
  { code: "DE", name: "Germany", alpha3: "DEU", numeric: "276" },
  { code: "GH", name: "Ghana", alpha3: "GHA", numeric: "288" },
  { code: "GI", name: "Gibraltar", alpha3: "GIB", numeric: "292" },
  { code: "GR", name: "Greece", alpha3: "GRC", numeric: "300" },
  { code: "GL", name: "Greenland", alpha3: "GRL", numeric: "304" },
  { code: "GD", name: "Grenada", alpha3: "GRD", numeric: "308" },
  { code: "GP", name: "Guadeloupe", alpha3: "GLP", numeric: "312" },
  { code: "GU", name: "Guam", alpha3: "GUM", numeric: "316" },
  { code: "GT", name: "Guatemala", alpha3: "GTM", numeric: "320" },
  { code: "GG", name: "Guernsey", alpha3: "GGY", numeric: "831" },
  { code: "GN", name: "Guinea", alpha3: "GIN", numeric: "324" },
  { code: "GW", name: "Guinea-Bissau", alpha3: "GNB", numeric: "624" },
  { code: "GY", name: "Guyana", alpha3: "GUY", numeric: "328" },
  { code: "HT", name: "Haiti", alpha3: "HTI", numeric: "332" },
  { code: "HM", name: "Heard Island and McDonald Islands", alpha3: "HMD", numeric: "334" },
  { code: "VA", name: "Holy See (the)", alpha3: "VAT", numeric: "336" },
  { code: "HN", name: "Honduras", alpha3: "HND", numeric: "340" },
  { code: "HK", name: "Hong Kong", alpha3: "HKG", numeric: "344" },
  { code: "HU", name: "Hungary", alpha3: "HUN", numeric: "348" },
  { code: "IS", name: "Iceland", alpha3: "ISL", numeric: "352" },
  { code: "IN", name: "India", alpha3: "IND", numeric: "356" },
  { code: "ID", name: "Indonesia", alpha3: "IDN", numeric: "360" },
  { code: "IR", name: "Iran (Islamic Republic of)", alpha3: "IRN", numeric: "364" },
  { code: "IQ", name: "Iraq", alpha3: "IRQ", numeric: "368" },
  { code: "IE", name: "Ireland", alpha3: "IRL", numeric: "372" },
  { code: "IM", name: "Isle of Man", alpha3: "IMN", numeric: "833" },
  { code: "IL", name: "Israel", alpha3: "ISR", numeric: "376" },
  { code: "IT", name: "Italy", alpha3: "ITA", numeric: "380" },
  { code: "JM", name: "Jamaica", alpha3: "JAM", numeric: "388" },
  { code: "JP", name: "Japan", alpha3: "JPN", numeric: "392" },
  { code: "JE", name: "Jersey", alpha3: "JEY", numeric: "832" },
  { code: "JO", name: "Jordan", alpha3: "JOR", numeric: "400" },
  { code: "KZ", name: "Kazakhstan", alpha3: "KAZ", numeric: "398" },
  { code: "KE", name: "Kenya", alpha3: "KEN", numeric: "404" },
  { code: "KI", name: "Kiribati", alpha3: "KIR", numeric: "296" },
  { code: "KP", name: "Korea (the Democratic People's Republic of)", alpha3: "PRK", numeric: "408" },
  { code: "KR", name: "Korea (the Republic of)", alpha3: "KOR", numeric: "410" },
  { code: "KW", name: "Kuwait", alpha3: "KWT", numeric: "414" },
  { code: "KG", name: "Kyrgyzstan", alpha3: "KGZ", numeric: "417" },
  { code: "LA", name: "Lao People's Democratic Republic (the)", alpha3: "LAO", numeric: "418" },
  { code: "LV", name: "Latvia", alpha3: "LVA", numeric: "428" },
  { code: "LB", name: "Lebanon", alpha3: "LBN", numeric: "422" },
  { code: "LS", name: "Lesotho", alpha3: "LSO", numeric: "426" },
  { code: "LR", name: "Liberia", alpha3: "LBR", numeric: "430" },
  { code: "LY", name: "Libya", alpha3: "LBY", numeric: "434" },
  { code: "LI", name: "Liechtenstein", alpha3: "LIE", numeric: "438" },
  { code: "LT", name: "Lithuania", alpha3: "LTU", numeric: "440" },
  { code: "LU", name: "Luxembourg", alpha3: "LUX", numeric: "442" },
  { code: "MO", name: "Macao", alpha3: "MAC", numeric: "446" },
  { code: "MK", name: "North Macedonia", alpha3: "MKD", numeric: "807" },
  { code: "MG", name: "Madagascar", alpha3: "MDG", numeric: "450" },
  { code: "MW", name: "Malawi", alpha3: "MWI", numeric: "454" },
  { code: "MY", name: "Malaysia", alpha3: "MYS", numeric: "458" },
  { code: "MV", name: "Maldives", alpha3: "MDV", numeric: "462" },
  { code: "ML", name: "Mali", alpha3: "MLI", numeric: "466" },
  { code: "MT", name: "Malta", alpha3: "MLT", numeric: "470" },
  { code: "MH", name: "Marshall Islands (the)", alpha3: "MHL", numeric: "584" },
  { code: "MQ", name: "Martinique", alpha3: "MTQ", numeric: "474" },
  { code: "MR", name: "Mauritania", alpha3: "MRT", numeric: "478" },
  { code: "MU", name: "Mauritius", alpha3: "MUS", numeric: "480" },
  { code: "YT", name: "Mayotte", alpha3: "MYT", numeric: "175" },
  { code: "MX", name: "Mexico", alpha3: "MEX", numeric: "484" },
  { code: "FM", name: "Micronesia (Federated States of)", alpha3: "FSM", numeric: "583" },
  { code: "MD", name: "Moldova (the Republic of)", alpha3: "MDA", numeric: "498" },
  { code: "MC", name: "Monaco", alpha3: "MCO", numeric: "492" },
  { code: "MN", name: "Mongolia", alpha3: "MNG", numeric: "496" },
  { code: "ME", name: "Montenegro", alpha3: "MNE", numeric: "499" },
  { code: "MS", name: "Montserrat", alpha3: "MSR", numeric: "500" },
  { code: "MA", name: "Morocco", alpha3: "MAR", numeric: "504" },
  { code: "MZ", name: "Mozambique", alpha3: "MOZ", numeric: "508" },
  { code: "MM", name: "Myanmar", alpha3: "MMR", numeric: "104" },
  { code: "NA", name: "Namibia", alpha3: "NAM", numeric: "516" },
  { code: "NR", name: "Nauru", alpha3: "NRU", numeric: "520" },
  { code: "NP", name: "Nepal", alpha3: "NPL", numeric: "524" },
  { code: "NL", name: "Netherlands (the)", alpha3: "NLD", numeric: "528" },
  { code: "NC", name: "New Caledonia", alpha3: "NCL", numeric: "540" },
  { code: "NZ", name: "New Zealand", alpha3: "NZL", numeric: "554" },
  { code: "NI", name: "Nicaragua", alpha3: "NIC", numeric: "558" },
  { code: "NE", name: "Niger (the)", alpha3: "NER", numeric: "562" },
  { code: "NG", name: "Nigeria", alpha3: "NGA", numeric: "566" },
  { code: "NU", name: "Niue", alpha3: "NIU", numeric: "570" },
  { code: "NF", name: "Norfolk Island", alpha3: "NFK", numeric: "574" },
  { code: "MP", name: "Northern Mariana Islands (the)", alpha3: "MNP", numeric: "580" },
  { code: "NO", name: "Norway", alpha3: "NOR", numeric: "578" },
  { code: "OM", name: "Oman", alpha3: "OMN", numeric: "512" },
  { code: "PK", name: "Pakistan", alpha3: "PAK", numeric: "586" },
  { code: "PW", name: "Palau", alpha3: "PLW", numeric: "585" },
  { code: "PS", name: "Palestine, State of", alpha3: "PSE", numeric: "275" },
  { code: "PA", name: "Panama", alpha3: "PAN", numeric: "591" },
  { code: "PG", name: "Papua New Guinea", alpha3: "PNG", numeric: "598" },
  { code: "PY", name: "Paraguay", alpha3: "PRY", numeric: "600" },
  { code: "PE", name: "Peru", alpha3: "PER", numeric: "604" },
  { code: "PH", name: "Philippines (the)", alpha3: "PHL", numeric: "608" },
  { code: "PN", name: "Pitcairn", alpha3: "PCN", numeric: "612" },
  { code: "PL", name: "Poland", alpha3: "POL", numeric: "616" },
  { code: "PT", name: "Portugal", alpha3: "PRT", numeric: "620" },
  { code: "PR", name: "Puerto Rico", alpha3: "PRI", numeric: "630" },
  { code: "QA", name: "Qatar", alpha3: "QAT", numeric: "634" },
  { code: "RE", name: "Réunion", alpha3: "REU", numeric: "638" },
  { code: "RO", name: "Romania", alpha3: "ROU", numeric: "642" },
  { code: "RU", name: "Russian Federation (the)", alpha3: "RUS", numeric: "643" },
  { code: "RW", name: "Rwanda", alpha3: "RWA", numeric: "646" },
  { code: "BL", name: "Saint Barthélemy", alpha3: "BLM", numeric: "652" },
  { code: "SH", name: "Saint Helena, Ascension and Tristan da Cunha", alpha3: "SHN", numeric: "654" },
  { code: "KN", name: "Saint Kitts and Nevis", alpha3: "KNA", numeric: "659" },
  { code: "LC", name: "Saint Lucia", alpha3: "LCA", numeric: "662" },
  { code: "MF", name: "Saint Martin (French part)", alpha3: "MAF", numeric: "663" },
  { code: "PM", name: "Saint Pierre and Miquelon", alpha3: "SPM", numeric: "666" },
  { code: "VC", name: "Saint Vincent and the Grenadines", alpha3: "VCT", numeric: "670" },
  { code: "WS", name: "Samoa", alpha3: "WSM", numeric: "882" },
  { code: "SM", name: "San Marino", alpha3: "SMR", numeric: "674" },
  { code: "ST", name: "Sao Tome and Principe", alpha3: "STP", numeric: "678" },
  { code: "SA", name: "Saudi Arabia", alpha3: "SAU", numeric: "682" },
  { code: "SN", name: "Senegal", alpha3: "SEN", numeric: "686" },
  { code: "RS", name: "Serbia", alpha3: "SRB", numeric: "688" },
  { code: "SC", name: "Seychelles", alpha3: "SYC", numeric: "690" },
  { code: "SL", name: "Sierra Leone", alpha3: "SLE", numeric: "694" },
  { code: "SG", name: "Singapore", alpha3: "SGP", numeric: "702" },
  { code: "SX", name: "Sint Maarten (Dutch part)", alpha3: "SXM", numeric: "534" },
  { code: "SK", name: "Slovakia", alpha3: "SVK", numeric: "703" },
  { code: "SI", name: "Slovenia", alpha3: "SVN", numeric: "705" },
  { code: "SB", name: "Solomon Islands", alpha3: "SLB", numeric: "090" },
  { code: "SO", name: "Somalia", alpha3: "SOM", numeric: "706" },
  { code: "ZA", name: "South Africa", alpha3: "ZAF", numeric: "710" },
  { code: "GS", name: "South Georgia and the South Sandwich Islands", alpha3: "SGS", numeric: "239" },
  { code: "SS", name: "South Sudan", alpha3: "SSD", numeric: "728" },
  { code: "ES", name: "Spain", alpha3: "ESP", numeric: "724" },
  { code: "LK", name: "Sri Lanka", alpha3: "LKA", numeric: "144" },
  { code: "SD", name: "Sudan (the)", alpha3: "SDN", numeric: "729" },
  { code: "SR", name: "Suriname", alpha3: "SUR", numeric: "740" },
  { code: "SJ", name: "Svalbard and Jan Mayen", alpha3: "SJM", numeric: "744" },
  { code: "SE", name: "Sweden", alpha3: "SWE", numeric: "752" },
  { code: "CH", name: "Switzerland", alpha3: "CHE", numeric: "756" },
  { code: "SY", name: "Syrian Arab Republic", alpha3: "SYR", numeric: "760" },
  { code: "TW", name: "Taiwan (Province of China)", alpha3: "TWN", numeric: "158" },
  { code: "TJ", name: "Tajikistan", alpha3: "TJK", numeric: "762" },
  { code: "TZ", name: "Tanzania, United Republic of", alpha3: "TZA", numeric: "834" },
  { code: "TH", name: "Thailand", alpha3: "THA", numeric: "764" },
  { code: "TL", name: "Timor-Leste", alpha3: "TLS", numeric: "626" },
  { code: "TG", name: "Togo", alpha3: "TGO", numeric: "768" },
  { code: "TK", name: "Tokelau", alpha3: "TKL", numeric: "772" },
  { code: "TO", name: "Tonga", alpha3: "TON", numeric: "776" },
  { code: "TT", name: "Trinidad and Tobago", alpha3: "TTO", numeric: "780" },
  { code: "TN", name: "Tunisia", alpha3: "TUN", numeric: "788" },
  { code: "TR", name: "Türkiye", alpha3: "TUR", numeric: "792" },
  { code: "TM", name: "Turkmenistan", alpha3: "TKM", numeric: "795" },
  { code: "TC", name: "Turks and Caicos Islands (the)", alpha3: "TCA", numeric: "796" },
  { code: "TV", name: "Tuvalu", alpha3: "TUV", numeric: "798" },
  { code: "UG", name: "Uganda", alpha3: "UGA", numeric: "800" },
  { code: "UA", name: "Ukraine", alpha3: "UKR", numeric: "804" },
  { code: "AE", name: "United Arab Emirates (the)", alpha3: "ARE", numeric: "784" },
  { code: "GB", name: "United Kingdom of Great Britain and Northern Ireland (the)", alpha3: "GBR", numeric: "826" },
  { code: "UM", name: "United States Minor Outlying Islands (the)", alpha3: "UMI", numeric: "581" },
  { code: "US", name: "United States of America (the)", alpha3: "USA", numeric: "840" },
  { code: "UY", name: "Uruguay", alpha3: "URY", numeric: "858" },
  { code: "UZ", name: "Uzbekistan", alpha3: "UZB", numeric: "860" },
  { code: "VU", name: "Vanuatu", alpha3: "VUT", numeric: "548" },
  { code: "VE", name: "Venezuela (Bolivarian Republic of)", alpha3: "VEN", numeric: "862" },
  { code: "VN", name: "Viet Nam", alpha3: "VNM", numeric: "704" },
  { code: "VG", name: "Virgin Islands (British)", alpha3: "VGB", numeric: "092" },
  { code: "VI", name: "Virgin Islands (U.S.)", alpha3: "VIR", numeric: "850" },
  { code: "WF", name: "Wallis and Futuna", alpha3: "WLF", numeric: "876" },
  { code: "EH", name: "Western Sahara", alpha3: "ESH", numeric: "732" },
  { code: "YE", name: "Yemen", alpha3: "YEM", numeric: "887" },
  { code: "ZM", name: "Zambia", alpha3: "ZMB", numeric: "894" },
  { code: "ZW", name: "Zimbabwe", alpha3: "ZWE", numeric: "716" },
];

/** Everyday names that the ISO short names do not contain as a substring. */
const ALIASES: Record<string, string[]> = {
  US: ['USA', 'United States', 'America'],
  GB: ['UK', 'United Kingdom', 'Great Britain', 'Britain', 'England', 'Scotland', 'Wales', 'Northern Ireland'],
  AE: ['UAE', 'Emirates', 'Dubai'],
  RU: ['Russia'],
  KR: ['South Korea', 'Korea'],
  KP: ['North Korea'],
  CD: ['DRC', 'DR Congo', 'Congo-Kinshasa', 'Democratic Republic of the Congo'],
  CG: ['Republic of the Congo', 'Congo-Brazzaville'],
  CI: ['Ivory Coast'],
  CZ: ['Czech Republic'],
  TR: ['Turkey'],
  IR: ['Iran'],
  SY: ['Syria'],
  LA: ['Laos'],
  VN: ['Vietnam'],
  TW: ['Taiwan'],
  BO: ['Bolivia'],
  VE: ['Venezuela'],
  TZ: ['Tanzania'],
  MD: ['Moldova'],
  FM: ['Micronesia'],
  PS: ['Palestine'],
  VA: ['Vatican', 'Vatican City'],
  MK: ['Macedonia'],
  SZ: ['Swaziland'],
  CV: ['Cape Verde'],
  MM: ['Burma'],
  NL: ['Holland'],
  BN: ['Brunei'],
  HK: ['Hong Kong'],
  MO: ['Macau'],
};

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

/** Lowercase, strip accents and the ISO "(the)" suffix, collapse spaces. */
export function normalizeCountryText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(the\)/g, '')
    .replace(/’/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Indexed {
  country: Country;
  names: string[];
}

function buildIndex(list: readonly Country[]): Indexed[] {
  return list.map((country) => ({
    country,
    names: [country.name, ...(ALIASES[country.code] ?? [])].map(normalizeCountryText),
  }));
}

const indexCache = new WeakMap<readonly Country[], Indexed[]>();
function indexFor(list: readonly Country[]): Indexed[] {
  let idx = indexCache.get(list);
  if (!idx) {
    idx = buildIndex(list);
    indexCache.set(list, idx);
  }
  return idx;
}

/** Lower is better; null means no match. */
function score(entry: Indexed, q: string): number | null {
  const { country, names } = entry;
  const upper = q.toUpperCase();
  if (upper === country.code) return 0;
  if (names.some((n) => n === q)) return 1;
  if (upper === country.alpha3) return 2;
  if (names.some((n) => n.startsWith(q))) return 3;
  if (names.some((n) => n.split(' ').some((w) => w.startsWith(q)))) return 4;
  if (names.some((n) => n.includes(q))) return 5;
  return null;
}

/**
 * Countries matching what someone typed, best first: exact code, exact name or
 * alias, alpha-3, name prefix, word prefix, substring. "Nigeria" -> NG first,
 * "ng" -> NG, "nga" -> NG, "uk" -> GB.
 */
export function searchCountries(query: string, list: readonly Country[] = COUNTRIES): Country[] {
  const q = normalizeCountryText(query);
  if (!q) return [...list];
  const hits: { c: Country; s: number; i: number }[] = [];
  indexFor(list).forEach((entry, i) => {
    const s = score(entry, q);
    if (s !== null) hits.push({ c: entry.country, s, i });
  });
  hits.sort((a, b) => a.s - b.s || a.i - b.i);
  return hits.map((h) => h.c);
}

/**
 * The one country this text unambiguously names (code, alpha-3, exact name or
 * alias), or null. Used to commit typed text without picking from the list.
 */
export function resolveCountry(text: string, list: readonly Country[] = COUNTRIES): Country | null {
  const best = searchCountries(text, list)[0];
  if (!best || !normalizeCountryText(text)) return null;
  const s = score(indexFor(list).find((e) => e.country === best)!, normalizeCountryText(text));
  return s !== null && s <= 2 ? best : null;
}

export function isCountryCode(code: string | null | undefined): boolean {
  return !!code && BY_CODE.has(code.toUpperCase());
}

/** Display name for a stored code, without the ISO "(the)"; falls back to the code. */
export function countryName(code: string | null | undefined): string {
  if (!code) return '';
  const c = BY_CODE.get(code.toUpperCase());
  return c ? c.name.replace(/\s*\(the\)$/, '') : code;
}
