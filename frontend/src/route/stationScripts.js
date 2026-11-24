// Station names in the local language + Hindi for the three-language boards.
// Local script follows the station's state (Telugu in AP/Telangana, Kannada in
// Karnataka, Tamil in Tamil Nadu, Marathi, Gujarati, Odia, Bengali); in
// Hindi-speaking states the board shows Hindi and English only.

const N = {
  // Guntakal - Kurnool / Rayalaseema
  GTL: ['te', 'గుంతకల్లు', 'गुंतकल'], MKR: ['te', 'మద్దికెర', 'मद्दिकेरा'], TGL: ['te', 'తుగ్గలి', 'तुग्गली'],
  EDD: ['te', 'ఎద్దులదొడ్డి', 'एद्दुलदोड्डी'], PDL: ['te', 'పెండేకల్లు', 'पेंडेकल्लु'], LMD: ['te', 'లింగనేనిదొడ్డి', 'लिंगनेनिदोड्डी'],
  MYL: ['te', 'మల్లియాల', 'मल्लियाला'], DHNE: ['te', 'డోన్', 'डोन'], BVO: ['te', 'బోగోలు', 'बोगोलु'], VDI: ['te', 'వెల్దుర్తి', 'वेल्दुर्ती'],
  UKD: ['te', 'ఉలిందకొండ', 'उलिंदकोंडा'], DUU: ['te', 'దూపాడు', 'दूपाडु'], KRNT: ['te', 'కర్నూలు సిటీ', 'कर्नूल सिटी'],
  GY: ['te', 'గుత్తి', 'गुत्ती'], ATP: ['te', 'అనంతపురం', 'अनंतपुर'], DMM: ['te', 'ధర్మవరం', 'धर्मावरम'],
  SSPN: ['te', 'శ్రీ సత్యసాయి ప్రశాంతి నిలయం', 'श्री सत्य साई प्रशांति निलयम'], PKD: ['te', 'పెనుకొండ', 'पेनुकोंडा'], HUP: ['te', 'హిందూపురం', 'हिंदूपुर'],
  TU: ['te', 'తాడిపత్రి', 'ताडिपत्री'], YA: ['te', 'ఎర్రగుంట్ల', 'येर्रगुंटला'], MOO: ['te', 'ముద్దనూరు', 'मुद्दनूरु'], HX: ['te', 'కడప', 'कडपा'],
  RJP: ['te', 'రాజంపేట', 'राजमपेट'], KOU: ['te', 'కోడూరు', 'कोडूर'], RU: ['te', 'రేణిగుంట', 'रेणिगुंटा'], TPTY: ['te', 'తిరుపతి', 'तिरुपति'],
  AD: ['te', 'ఆదోని', 'आदोनी'], MALM: ['te', 'మంత్రాలయం రోడ్', 'मंत्रालयम रोड'], NDL: ['te', 'నంద్యాల', 'नंद्याल'], BMH: ['te', 'బేతంచెర్ల', 'बेतमचेर्ला'],
  GID: ['te', 'గిద్దలూరు', 'गिद्दलूर'], CBM: ['te', 'కంభం', 'कंबम'], MRK: ['te', 'మార్కాపూర్ రోడ్', 'मार्कापुर रोड'], VKN: ['te', 'వినుకొండ', 'विनुकोंडा'],
  NRT: ['te', 'నరసరావుపేట', 'नरसरावपेट'], GNT: ['te', 'గుంటూరు', 'गुंटूर'], KCC: ['te', 'కృష్ణా కెనాల్', 'कृष्णा कैनाल'], BZA: ['te', 'విజయవాడ', 'विजयवाड़ा'],
  // Telangana
  SC: ['te', 'సికింద్రాబాద్', 'सिकंदराबाद'], HYB: ['te', 'హైదరాబాద్', 'हैदराबाद'], KCG: ['te', 'కాచిగూడ', 'काचीगुडा'], GWD: ['te', 'గద్వాల', 'गद्वाल'],
  WPR: ['te', 'వనపర్తి రోడ్', 'वनपर्ती रोड'], MBNR: ['te', 'మహబూబ్‌నగర్', 'महबूबनगर'], JCL: ['te', 'జడ్చర్ల', 'जड़चर्ला'], SHNR: ['te', 'షాద్‌నగర్', 'शादनगर'],
  UR: ['te', 'ఉందానగర్', 'उमदानगर'], VKB: ['te', 'వికారాబాద్', 'विकाराबाद'], TDU: ['te', 'తాండూరు', 'तांडूर'], LPI: ['te', 'లింగంపల్లి', 'लिंगमपल्ली'],
  SBBJ: ['te', 'శ్రీ బాల బ్రహ్మేశ్వర జోగులాంబ', 'श्री बाल ब्रह्मेश्वर जोगुलांबा'], KZJ: ['te', 'కాజీపేట', 'काजीपेट'], RDM: ['te', 'రామగుండం', 'रामागुंडम'],
  BG: ['te', 'భువనగిరి', 'भुवनगिरी'], MCI: ['te', 'మంచిర్యాల', 'मंचिर्याल'],
  // Coastal AP
  NLR: ['te', 'నెల్లూరు', 'नेल्लोर'], GDR: ['te', 'గూడూరు', 'गूडूर'], OGL: ['te', 'ఒంగోలు', 'ओंगोल'], TEL: ['te', 'తెనాలి', 'तेनाली'],
  EE: ['te', 'ఏలూరు', 'एलुरु'], RJY: ['te', 'రాజమండ్రి', 'राजमुंदरी'], SLO: ['te', 'సామర్లకోట', 'सामलकोट'], VSKP: ['te', 'విశాఖపట్నం', 'विशाखापट्टणम'],
  // Karnataka
  SBC: ['kn', 'ಕೆಎಸ್ಆರ್ ಬೆಂಗಳೂರು', 'केएसआर बेंगलुरु'], YNK: ['kn', 'ಯಲಹಂಕ', 'येलहंका'], GBD: ['kn', 'ಗೌರಿಬಿದನೂರು', 'गौरीबिदनूर'],
  RC: ['kn', 'ರಾಯಚೂರು', 'रायचूर'], YG: ['kn', 'ಯಾದಗಿರಿ', 'यादगीर'], WADI: ['kn', 'ವಾಡಿ', 'वाडी'], KLBG: ['kn', 'ಕಲಬುರಗಿ', 'कलबुर्गी'],
  KSN: ['kn', 'ಕೃಷ್ಣಾ', 'कृष्णा'], SADP: ['kn', 'ಸೈದಾಪುರ', 'सैदापुर'],
  // Tamil Nadu
  MAS: ['ta', 'சென்னை சென்ட்ரல்', 'चेन्नई सेंट्रल'], PER: ['ta', 'பெரம்பூர்', 'पेरम्बूर'], AJJ: ['ta', 'அரக்கோணம்', 'अरक्कोणम'],
  CBE: ['ta', 'கோயம்புத்தூர்', 'कोयंबटूर'], TUP: ['ta', 'திருப்பூர்', 'तिरुप्पुर'], ED: ['ta', 'ஈரோடு', 'ईरोड'], SA: ['ta', 'சேலம்', 'सेलम'],
  // Maharashtra
  CSMT: ['mr', 'छत्रपती शिवाजी महाराज टर्मिनस', 'छत्रपति शिवाजी महाराज टर्मिनस'], DR: ['mr', 'दादर', 'दादर'], TNA: ['mr', 'ठाणे', 'ठाणे'],
  KYN: ['mr', 'कल्याण', 'कल्याण'], PUNE: ['mr', 'पुणे', 'पुणे'], DD: ['mr', 'दौंड', 'दौंड'], SUR: ['mr', 'सोलापूर', 'सोलापुर'], LNL: ['mr', 'लोणावळा', 'लोनावला'],
  // Gujarat
  ADI: ['gu', 'અમદાવાદ', 'अहमदाबाद'], BRC: ['gu', 'વડોદરા', 'वडोदरा'], ST: ['gu', 'સુરત', 'सूरत'],
  // Odisha / Bengal
  BBS: ['or', 'ଭୁବନେଶ୍ୱର', 'भुवनेश्वर'], CTC: ['or', 'କଟକ', 'कटक'], KUR: ['or', 'ଖୋର୍ଦ୍ଧା ରୋଡ୍', 'खोर्धा रोड'],
  HWH: ['bn', 'হাওড়া', 'हावड़ा'], KGP: ['bn', 'খড়্গপুর', 'खड़गपुर'], SRC: ['bn', 'সাঁতরাগাছি', 'संतरागाछी'],
  // Hindi belt
  NDLS: ['hi', null, 'नई दिल्ली'], NZM: ['hi', null, 'हज़रत निज़ामुद्दीन'], JP: ['hi', null, 'जयपुर'], AGC: ['hi', null, 'आगरा कैंट'],
  BPL: ['hi', null, 'भोपाल'], ET: ['hi', null, 'इटारसी'], NGP: ['mr', 'नागपूर', 'नागपुर'], GWL: ['hi', null, 'ग्वालियर'], AII: ['hi', null, 'अजमेर']
};

export const SCRIPT_FONT = {
  te: '"Kohinoor Telugu", "Noto Sans Telugu", "Telugu Sangam MN", "Nirmala UI", sans-serif',
  kn: '"Kannada Sangam MN", "Noto Sans Kannada", "Nirmala UI", sans-serif',
  ta: '"Tamil Sangam MN", "Noto Sans Tamil", "Nirmala UI", sans-serif',
  mr: '"Kohinoor Devanagari", "Noto Sans Devanagari", "Devanagari Sangam MN", "Nirmala UI", sans-serif',
  hi: '"Kohinoor Devanagari", "Noto Sans Devanagari", "Devanagari Sangam MN", "Nirmala UI", sans-serif',
  gu: '"Gujarati Sangam MN", "Noto Sans Gujarati", "Nirmala UI", sans-serif',
  or: '"Oriya Sangam MN", "Noto Sans Oriya", "Nirmala UI", sans-serif',
  bn: '"Bangla Sangam MN", "Noto Sans Bengali", "Nirmala UI", sans-serif'
};

// Rough phonetic Devanagari for names missing from the table.
function toDevanagari(name) {
  const V = { a: 'अ', aa: 'आ', i: 'इ', ee: 'ई', u: 'उ', oo: 'ऊ', e: 'ए', ai: 'ऐ', o: 'ओ', au: 'औ' };
  const M = { a: '', aa: 'ा', i: 'ि', ee: 'ी', u: 'ु', oo: 'ू', e: 'े', ai: 'ै', o: 'ो', au: 'ौ' };
  const C = { kh: 'ख', gh: 'घ', ch: 'च', jh: 'झ', th: 'थ', dh: 'ध', ph: 'फ', bh: 'भ', sh: 'श', k: 'क', g: 'ग', c: 'क', j: 'ज', t: 'ट', d: 'ड', n: 'न', p: 'प', b: 'ब', m: 'म', y: 'य', r: 'र', l: 'ल', v: 'व', w: 'व', s: 'स', h: 'ह', z: 'ज़', f: 'फ़', q: 'क', x: 'क्स' };
  return name.toLowerCase().split(/\s+/).map((w) => {
    let out = '', i = 0, pend = false;
    while (i < w.length) {
      const two = w.slice(i, i + 2);
      if (C[two] || C[w[i]]) {
        if (pend) out += '्';
        out += C[two] || C[w[i]]; i += C[two] ? 2 : 1; pend = true;
      } else {
        const vk = ['aa', 'ee', 'oo', 'ai', 'au'].includes(two) ? two : w[i];
        if (V[vk] !== undefined) { out += pend ? M[vk] : V[vk]; pend = false; i += vk.length; } else i++;
      }
    }
    return out;
  }).join(' ');
}

const clean = (name) => name.replace(/\b(JN|JN\.|JUNCTION|CANTT|ROAD)\b/g, (m) => (m === 'ROAD' ? 'ROAD' : '')).replace(/\s+/g, ' ').trim();

export function boardNames(code, englishName) {
  const e = N[code];
  if (e) return { lang: e[0], local: e[1], hi: e[2] };
  return { lang: 'hi', local: null, hi: toDevanagari(clean(englishName).replace(/ ROAD$/, ' रोड')) };
}

// Natural spoken form: "GUNTAKAL JN" -> "Guntakal", "KURNOOL CITY" -> "Kurnool City".
export function spokenName(name) {
  return name
    .replace(/\b(JN|JN\.|JUNCTION)\b/gi, '')
    .replace(/\bCANTT\b/gi, 'Cantonment')
    .replace(/\bCSMT\b/g, 'C S M T')
    .replace(/\bKSR\b/g, 'K S R')
    .replace(/\bMGR\b/g, 'M G R')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(C S M T|K S R|M G R)\b/gi, (m) => m.toUpperCase());
}
