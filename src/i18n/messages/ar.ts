import type { Messages } from './en.js';

/**
 * Arabic (Modern Standard Arabic) message catalog.
 *
 * Terminology follows UNHCR's Arabic usage: لاجئون، طالبو لجوء، نازحون
 * داخلياً، عديمو الجنسية، العائدون، الحماية التكميلية. IPC phase names follow
 * the official Arabic IPC manual (الحد الأدنى، الضغط، الأزمة، الطوارئ،
 * الكارثة/المجاعة).
 *
 * Phrasing deliberately avoids number–noun agreement (العدد والمعدود) by
 * putting counts in parentheses or after a colon, so sentences stay
 * grammatical for any value.
 */
export const ar: Messages = {
  meta: {
    showMetricKeys: false,
    listSeparator: '، ',
    dotSeparator: ' · ',
  },
  common: {
    noData: '_لا توجد بيانات._',
    noRecentData: '_لا توجد بيانات حديثة._',
    na: 'غير متاح',
    year: 'السنة',
    country: 'البلد',
    indicator: 'المؤشر',
    people: 'عدد الأشخاص',
    peopleInYear: (year: string) => `عدد الأشخاص (${year})`,
    origin: 'بلد المنشأ',
    refugees: 'اللاجئون',
    region: 'المنطقة',
    source: 'المصدر',
    total: 'الإجمالي',
    sourceLine: (citation: string, producer: string) =>
      `_المصدر: ${producer ? `${producer} — ` : ''}${citation}_`,
    range: (from: string, to: string) => (from === to ? from : `من ${from} إلى ${to}`),
    side: (role: 'asylum' | 'origin') =>
      role === 'asylum' ? ' (بحسب بلد اللجوء)' : ' (بحسب بلد المنشأ)',
    truncatedNote: '\n\n_ملاحظة: مجموعة النتائج كبيرة جداً؛ المجاميع مقتطعة._',
  },
  units: {
    people: 'شخص',
    population: 'لكل 1,000 نسمة',
    gdp: 'لكل مليار دولار أمريكي من الناتج المحلي الإجمالي',
  },
  denominators: {
    kind: { population: 'عدد السكان', gdp: 'الناتج المحلي الإجمالي' },
    valuesNote: (unit: string, kind: string, citation: string) =>
      `\n\n_القيم محسوبة ${unit} — قاسم ${kind} مطابَق حسب السنة (${citation})._`,
    missingNote: (codes: string) =>
      `\n\n_لا تتوفر بيانات القاسم للبلدان التالية: ${codes} — استُبعدت من السلاسل المعيارية._`,
    rankedNote: (unit: string, kind: string, citation: string, year: string) =>
      `\n\n_الترتيب ${unit} — قاسم ${kind} من ${citation}. تُعرض سنة القاسم لكل صف عندما تسبق سنة ${year}._`,
    skippedNote: (count: string) =>
      `\n\n_استُبعدت بلدان لا تتوفر لها بيانات القاسم (عددها: ${count})._`,
  },
  search: {
    match: 'درجة التطابق',
  },
  profile: {
    title: (name: string, year: string | undefined) =>
      `# ${name} — الملف الإنساني${year ? ` (${year})` : ''}`,
    infoLine: (region: string, iso3: string, source: string) =>
      `**المنطقة:** ${region} · **رمز ISO3:** ${iso3} · **المصدر:** ${source}`,
    hosted: '## المستضافون داخل البلد',
    abroad: '## النازحون من البلد',
    topOrigins: '## أبرز بلدان منشأ اللاجئين المستضافين',
  },
  compare: {
    heading: (metric: string, unit: string | undefined, side: string, range: string) =>
      `**${metric}**${unit ? ` (${unit})` : ''}${side}، ${range}`,
    latest: (year: string, summary: string) => `أحدث القيم (${year}): ${summary}`,
    noOverlap: 'لا توجد بيانات متداخلة',
  },
  population: {
    heading: (name: string, side: string, range: string) =>
      `أرقام النزوح — **${name}**${side}، ${range}`,
    headers: [
      'السنة',
      'اللاجئون',
      'طالبو اللجوء',
      'النازحون داخلياً',
      'عديمو الجنسية',
      'إجمالي المشمولين بالاهتمام',
    ],
  },
  demographics: {
    noData: (name: string, role: string) =>
      `لا تتوفر بيانات ديموغرافية حديثة عن ${name} ${role === 'asylum' ? 'بحسب بلد اللجوء' : 'بحسب بلد المنشأ'}. لا تغطي البيانات الديموغرافية للمفوضية إلا السنوات الأخيرة — جرّب أداة refugee_population للحصول على المجاميع.`,
    headers: ['الفئة العمرية', 'الإناث', 'الذكور', 'النسبة من الإجمالي'],
    heading: (name: string, side: string, year: string) =>
      `التركيبة الديموغرافية — **${name}**${side}، ${year}`,
    totalLine: (total: string, pctFemale: string) =>
      `الإجمالي: **${total}** (نسبة الإناث ${pctFemale})`,
    female: 'إناث',
    male: 'ذكور',
    age: {
      '0_4': '0–4',
      '5_11': '5–11',
      '12_17': '12–17',
      '18_59': '18–59',
      '60': '60+',
      other: 'عمر غير معروف',
      total: 'جميع الأعمار',
    },
  },
  latest: {
    global: 'العالم',
    noData: (scope: string) => `لم يُعثر على إحصاءات حديثة عن ${scope}.`,
    heading: (scope: string, side: string, year: string) =>
      `أحدث الإحصاءات — **${scope}**${side}، ${year}`,
  },
  asylum: {
    applications: 'طلبات اللجوء',
    applicationsHeading: (name: string, side: string, range: string) =>
      `طلبات اللجوء — **${name}**${side}، ${range}`,
    decisionHeaders: [
      'السنة',
      'الاعتراف بصفة اللاجئ',
      'الحماية التكميلية',
      'الرفض',
      'الإغلاق لأسباب أخرى',
      'الإجمالي',
      'معدل الاعتراف',
    ],
    decisionsHeading: (name: string, side: string, range: string) =>
      `قرارات اللجوء — **${name}**${side}، ${range}`,
    recognitionNote: (citation: string, producer: string) =>
      `_معدل الاعتراف = (قرارات الاعتراف + الحماية التكميلية) ÷ القرارات الموضوعية. المصدر: ${producer ? `${producer} — ` : ''}${citation}_`,
  },
  solutions: {
    heading: (name: string, side: string, range: string) =>
      `الحلول الدائمة — **${name}**${side}، ${range}`,
    headers: [
      'السنة',
      'عودة اللاجئين',
      'إعادة التوطين',
      'التجنّس',
      'عودة النازحين داخلياً',
      'إجمالي الحلول',
    ],
    normalizedHeader: (unit: string) => `الإجمالي ${unit}`,
    periodTotal: 'إجمالي الفترة',
    noData: (name: string, side: string, range: string) =>
      `لا تتوفر بيانات عن الحلول الدائمة في ${name}${side} (${range}). لا تُبلغ المفوضية عن العودة وإعادة التوطين والتجنّس إلا حيث حدثت — جرّب role="origin" أو نطاقاً أوسع من السنوات.`,
    perspective: {
      origin: (name: string) =>
        `_منظور بلد المنشأ: اللاجئون العائدون إلى ${name}، ومواطنو ${name} الذين أُعيد توطينهم أو تجنّسوا في الخارج، وعودة النازحين داخلياً في ${name}._`,
      asylum: (name: string) =>
        `_منظور بلد اللجوء: اللاجئون الذين غادروا ${name} عائدين إلى بلدانهم، والأشخاص الذين أُعيد توطينهم في ${name} أو تجنّسوا فيها، وعودة النازحين داخلياً في ${name}._`,
    },
    mixLine: (items: string) => `**توزيع الحلول خلال الفترة:** ${items}`,
    flowNote:
      '_الحلول الدائمة تدفقات مسجّلة خلال كل سنة وليست أرصدة في نهاية العام، لذا يصحّ جمعها عبر السنوات (بخلاف refugee_population). تعني العلامة «—» أن المفوضية لم تُبلغ عن قيمة، وهذا لا يعني الصفر._',
  },
  trend: {
    noData: (metric: string, name: string, side: string, range: string) =>
      `لا توجد بيانات عن مؤشر «${metric}» في ${name}${side} للفترة ${range}.`,
    deltaPrev: 'التغيّر عن السنة السابقة',
    deltaPct: 'التغيّر %',
    noneDetected: 'لم تُرصد أي سنة شاذة',
    anomaly: (year: string, change: string, z: string) => `${year} (${change}، z=${z})`,
    heading: (metric: string, name: string, side: string, range: string) =>
      `الاتجاه — **${metric}**، ${name}${side}، ${range}`,
    direction: {
      increasing: 'تصاعدي',
      decreasing: 'تنازلي',
      stable: 'مستقر',
    },
    directionLine: (direction: string, slope: string, r2: string) =>
      `**الاتجاه العام:** ${direction} (${slope} سنوياً، R²=${r2})`,
    cagrLine: (cagr: string) => `**معدل النمو السنوي المركّب:** ${cagr}`,
    anomaliesLine: (text: string) => `**سنوات شاذة إحصائياً:** ${text}`,
    changepointsLine: (text: string) => `**نقاط التحوّل (الانقطاعات الهيكلية):** ${text}`,
    changepoint: (year: string, shift: string, slopeBefore: string, slopeAfter: string) =>
      `${year} (قفزة ${shift} مقارنةً بالاتجاه السابق؛ الميل من ${slopeBefore} إلى ${slopeAfter} سنوياً)`,
    noChangepoints: 'لم تُرصد أي نقطة تحوّل',
    changepointMethod:
      '_نقاط التحوّل: تجزئة مثلى مُعاقَبة (التقسيم الأمثل) بدالة تكلفة خطية مجزّأة، وعقوبة من نوع BIC، وتقدير متين للضوضاء (MAD)، وبحد أدنى 3 سنوات لكل مقطع — لذا يُؤرَّخ أي انقطاع في آخر سنتين ببداية آخر نافذة من 3 سنوات على الأكثر؛ راجع درجات z للسنوات الأخيرة. هذه انقطاعات مرشّحة تحتاج إلى تفسير (مثلاً عبر situation_reports)، وليست دليلاً قاطعاً._',
  },
  forecast: {
    notEnough: (metric: string, name: string, found: string) =>
      `لا يكفي التاريخ المتاح لإسقاط مؤشر «${metric}» في ${name} (يلزم 3 نقاط بيانات على الأقل، والمتاح: ${found}).`,
    caveat:
      'استقراء خطي بسيط لبيانات المفوضية التاريخية. النزوح تحرّكه أحداث لا يمكن لخط مستقيم أن يتنبأ بها؛ لذا يُعامَل هذا الإسقاط مؤشراً على حجم الظاهرة فحسب، لا رقماً تخطيطياً صادراً عن المفوضية.',
    type: 'النوع',
    observed: 'فعلي',
    projected: 'متوقَّع',
    heading: (metric: string, name: string) => `الإسقاط — **${metric}**، ${name}`,
    intervalHeaders: ['الحد الأدنى 80%', 'الحد الأعلى 80%', 'الحد الأدنى 95%', 'الحد الأعلى 95%'],
    intervalNote:
      '_فترات التنبؤ (80% و95%) مشتقة من ملاءمة المربعات الصغرى (توزيع t لستيودنت بدرجات حرية n−2). وهي تفترض نموذج الخط المستقيم واستقلال البواقي، ولا تغطي إلا التذبذب المعتاد من سنة إلى أخرى — لا الصدمات كاندلاع نزاع جديد، لذا فإن عدم اليقين الفعلي أكبر._',
    fitWindow: (range: string) => `_الملاءمة على الفترة: ${range}._`,
    breakAcross: (year: string) =>
      `_رُصد انقطاع هيكلي في ${year}، والخط مُلاءَم عبره. يمكن تمرير since_break: true._`,
    breakSince: (year: string) =>
      `_رُصد انقطاع هيكلي في ${year}، والخط مُلاءَم على البيانات اللاحقة له فقط._`,
    chartTitle: (metric: string, name: string, source: string) =>
      `${metric} — ${name}: القيم الفعلية والمتوقَّعة — ${source}`,
    observedSeries: (name: string) => `${name} (فعلي)`,
    projectedSeries: (name: string) => `${name} (متوقَّع)`,
    band: (level: string) => `فترة التنبؤ ${level}`,
  },
  ranking: {
    noLatestYear: 'تعذّر تحديد آخر سنة تتوفر عنها بيانات.',
    denomYear: 'سنة القاسم',
    heading: (
      count: string,
      by: 'asylum' | 'origin',
      metric: string,
      unit: string | undefined,
      year: string,
    ) =>
      `ترتيب ${by === 'asylum' ? 'البلدان المضيفة' : 'بلدان المنشأ'} حسب مؤشر «${metric}»${unit ? ` (${unit})` : ''} — أعلى ${count}، ${year}`,
  },
  crisis: {
    conflictNoData: (name: string, range: string) =>
      `لا توجد بيانات عن أحداث النزاع في ${name} للفترة ${range}. تتبع التغطية بيانات ACLED عبر منصة HDX؛ جرّب نطاق سنوات أوسع.`,
    conflictHeaders: ['السنة', 'أحداث النزاع', 'الوفيات'],
    conflictHeading: (name: string, range: string) => `أحداث النزاع — **${name}**، ${range}`,
    foodNoData: (name: string, year: string | undefined) =>
      `لا توجد بيانات عن الأمن الغذائي (IPC) في ${name}${year ? ` في ${year}` : ''}. لا يغطي التصنيف المرحلي المتكامل إلا البلدان التي تجري فيها تحليلات قائمة.`,
    ipcPhase: 'مرحلة التصنيف (IPC)',
    ipcPhases: {
      ipc_phase_1: 'المرحلة 1 — الحد الأدنى',
      ipc_phase_2: 'المرحلة 2 — الضغط',
      ipc_phase_3: 'المرحلة 3 — الأزمة',
      ipc_phase_4: 'المرحلة 4 — الطوارئ',
      ipc_phase_5: 'المرحلة 5 — الكارثة/المجاعة',
    },
    foodHeading: (name: string, year: string) => `الأمن الغذائي — **${name}**، ${year}`,
    crisisOrWorse: (people: string) => `في مرحلة الأزمة أو أسوأ (المرحلة 3 فأعلى): **${people}**`,
    fundingNoData: (name: string, range: string) =>
      `لا توجد بيانات عن التمويل الإنساني في ${name} للفترة ${range}. تتابع خدمة التتبع المالي (FTS) البلدان التي لديها نداءات منسَّقة فقط.`,
    fundingHeaders: [
      'السنة',
      'الاحتياجات (دولار أمريكي)',
      'التمويل المستلَم (دولار أمريكي)',
      'نسبة التغطية',
    ],
    fundingHeading: (name: string, range: string) => `التمويل الإنساني — **${name}**، ${range}`,
    reportsNoData: (name: string, range: string) =>
      `لم يُعثر على تقارير حالة عن ${name} للفترة ${range}. تتفاوت تغطية ريليف ويب بحسب الأزمة؛ جرّب نطاق سنوات أوسع، أو استخدم أداة provider_health إذا استمرت المشكلة.`,
    reportsHeader: 'عدد التقارير',
    undated: 'بلا تاريخ',
    latestReports: (query: string | undefined) =>
      `**أحدث التقارير**${query ? ` المطابقة لـ«${query}»` : ''}`,
    noneInRange: '_لا يوجد ضمن النطاق_',
    reportsHeading: (name: string, range: string) => `تقارير الحالة — **${name}**، ${range}`,
  },
  charts: {
    noData: (metric: string, range: string) =>
      `لم يُعثر على بيانات عن مؤشر «${metric}» لهذه البلدان في الفترة ${range}.`,
    title: (metricLabel: string, side: string, range: string, source: string) =>
      `${metricLabel}${side}، ${range} — ${source}`,
    chartjsIntro: (title: string) => `إعدادات Chart.js v4 للرسم «${title}»:`,
    vegaIntro: (title: string) => `مواصفة Vega-Lite v5 للرسم «${title}»:`,
    svgIntro: (title: string) => `رسم SVG بعنوان «${title}»:`,
    mapHeading: (
      count: string,
      by: 'asylum' | 'origin',
      metric: string,
      year: string,
      features: string,
      skipped: string | undefined,
    ) =>
      `خريطة GeoJSON — ${by === 'asylum' ? 'البلدان المضيفة' : 'بلدان المنشأ'} الأعلى حسب مؤشر «${metric}» (العدد: ${count})، ${year} (عدد المعالم: ${features}${skipped ? `؛ بلا إحداثيات مركزية: ${skipped}` : ''})`,
    refugeesHostedIn: (name: string) => `اللاجئون المستضافون في ${name}`,
    breakMarker: (year: string) => `تحوّل ${year}`,
    breakMarkerFor: (name: string, year: string) => `${name}: تحوّل ${year}`,
    millions: (v: string) => `${v} مليون`,
    thousands: (v: string) => `${v} ألف`,
  },
  report: {
    progress: {
      history: 'جارٍ جلب سجل النزوح',
      origins: 'جارٍ جلب التوزيع حسب بلد المنشأ',
      asylum: 'جارٍ جلب أرقام اللجوء',
      demographics: 'جارٍ جلب البيانات الديموغرافية',
      composing: 'جارٍ إعداد التقرير',
    },
    title: (name: string) => `# ${name} — تقرير عن الوضع الإنساني`,
    generatedBy: (citation: string, range: string) =>
      `> أُعدّ بواسطة ملجأ (malja-mcp) · المصدر: ${citation} · الفترة ${range}`,
    keyFigures: '## أبرز الأرقام',
    noDisplacement: '_لا توجد بيانات نزوح ضمن النطاق._',
    overTime: '## تطوّر أعداد اللاجئين عبر السنوات',
    trendLine: (direction: 'increasing' | 'decreasing', slope: string, r2: string) =>
      `الاتجاه: ${direction === 'increasing' ? 'تصاعدي، بزيادة تقارب' : 'تنازلي، بانخفاض يقارب'} ${slope} شخص سنوياً (R²=${r2}).`,
    lastChange: (pct: string) => ` التغيّر في السنة الأخيرة مقارنةً بالسنة السابقة: ${pct}.`,
    noRefugees: '_لا توجد بيانات عن اللاجئين ضمن النطاق._',
    whereFrom: '## من أين يأتي اللاجئون',
    decisions: '## قرارات اللجوء (آخر 5 سنوات)',
    decisionHeaders: ['السنة', 'الاعتراف بصفة اللاجئ', 'الرفض', 'الإغلاق لأسباب أخرى', 'الإجمالي'],
    noDecisions: '_لا توجد بيانات عن قرارات اللجوء ضمن النطاق._',
    demographics: '## التركيبة الديموغرافية',
    asOf: (year: string, total: string) =>
      `حتى عام ${year}: **${total}** شخص من المشمولين باهتمام المفوضية`,
    shares: (female: string, children: string) =>
      `، نسبة الإناث ${female}، ونسبة الأطفال (0–17 سنة) ${children}.`,
    noDemographics: '_لا يتوفر توزيع ديموغرافي حديث._',
    methodNotes:
      '_ملاحظات منهجية: الأرقام أرصدة نهاية العام الصادرة عن المفوضية السامية للأمم المتحدة لشؤون اللاجئين. يجمع «إجمالي المشمولين بالاهتمام» اللاجئين وطالبي اللجوء والنازحين داخلياً وعديمي الجنسية وغيرهم من المشمولين باهتمام المفوضية والأشخاص الآخرين المحتاجين إلى حماية دولية. هذا تقرير مُولَّد آلياً — تحقّق من الأرقام عبر unhcr.org/refugee-statistics قبل النشر._',
  },
  exports: {
    csvIntro: (dataset: string, rows: string, withManifest: boolean) =>
      `تصدير CSV — ${dataset}، عدد الصفوف: ${rows}${withManifest ? ' (بيان الاستخراج في أسطر تعليق تبدأ بـ`#` — اقرأه باستخدام `comment="#"`)' : ''}:`,
    jsonIntro: (dataset: string, rows: string) => `تصدير JSON — ${dataset}، عدد الصفوف: ${rows}:`,
    geojsonIntro: (dataset: string, features: string, skipped: string | undefined) =>
      `تصدير GeoJSON — ${dataset}، عدد المعالم: ${features}${skipped ? ` (بلا إحداثيات مركزية: ${skipped})` : ''}:`,
    manifestLabel: 'بيان الاستخراج',
    codebookHeading: '## دليل المتغيرات',
    truncated: (rows: string) =>
      `_ملاحظة: اقتُطعت النتائج إلى ${rows} صفاً. ضيّق نطاق السنوات أو صفِّ حسب البلد للحصول على مجموعة كاملة._`,
  },
  htmlReport: {
    defaultTitle: 'تقرير ملجأ',
    manifestHeading: 'بيان الاستخراج',
    manifestIntro:
      'أعد تنفيذ هذا الاستدعاء نفسه على إصدار الخادم ذاته لإعادة إنتاج الأرقام الواردة في هذه الوثيقة. تخضع السلاسل الأصلية للمراجعة بمرور الوقت — اذكر تاريخ الاستخراج عند الاستشهاد.',
    manifestFields: {
      tool: 'الأداة',
      arguments: 'المعطيات',
      extracted_at: 'وقت الاستخراج (UTC)',
      server: 'الخادم',
      source: 'المصدر',
      citation: 'الاستشهاد',
      content_sha256: 'بصمة المحتوى SHA-256',
    },
    footer: (server: string, date: string) =>
      `أُنشئ بواسطة ${server} بتاريخ ${date} من بيانات عامة رسمية، للقراءة فقط. تحقّق من الأرقام في المصادر المذكورة قبل النشر.`,
    mermaidNote: 'مصدر الرسم البياني (Mermaid) — الصقه في عارض Mermaid لعرضه.',
    noInput:
      'حدِّد إما country (للحصول على تقرير قُطري كامل) أو markdown (مخرجات Markdown لأي أداة) لتصديره.',
    htmlReady: (title: string, size: string) =>
      `تقرير HTML جاهز للطباعة «${title}» (${size} كيلوبايت): مستقل بذاته — خط عربي/لاتيني مضمَّن، ورسوم بيانية مضمَّنة، والاستشهادات وبيان الاستخراج؛ دون أي طلبات خارجية. افتحه في المتصفح للقراءة أو الطباعة.`,
    pdfReady: (title: string, size: string, engine: string) =>
      `تقرير PDF «${title}» (${size} كيلوبايت)، أُنتج من ملف HTML الجاهز للطباعة بواسطة ${engine}.`,
    pdfFallback: (reason: string) =>
      `تعذّر إنتاج PDF هنا (${reason})، لذا أُعيد ملف HTML الجاهز للطباعة بدلاً منه: افتحه في أي متصفح واختر طباعة ← حفظ بصيغة PDF — التنسيق مهيّأ مسبقاً لمقاس A4 والطباعة.`,
    reasons: {
      disabled: 'معطَّل عبر MALJA_PDF=off',
      noBrowser: 'لم يُعثر على Chrome أو Chromium أو Edge — ثبّت أحدها أو اضبط MALJA_CHROME_PATH',
    },
    failed: (detail: string) => `أخفق المتصفح غير المرئي: ${detail}`,
    linkNote: (uri: string) =>
      `نزّل الملف من رابط المورد (${uri})؛ يُحتفظ به في ذاكرة الخادم لمدة ساعة. مرِّر inline: true لتضمينه في هذه النتيجة بدلاً من ذلك.`,
  },
  codebook: {
    headers: ['المتغير', 'الوصف', 'الوحدة'],
    units: {
      text: 'نص',
      ISO3: 'ISO3',
      year: 'سنة',
      id: 'معرّف',
      'ISO timestamp': 'طابع زمني ISO',
      persons: 'أشخاص',
      applications: 'طلبات',
      decisions: 'قرارات',
      'current US$': 'دولار أمريكي بالأسعار الجارية',
      '% of population': '% من السكان',
      events: 'أحداث',
      '%': '%',
      reports: 'تقارير',
    },
    fields: {
      country: 'اسم البلد الذي يتناوله الصف.',
      country_code: 'رمز البلد وفق المعيار ISO 3166-1 (ثلاثة أحرف).',
      origin: 'بلد المنشأ، حين تميّز مجموعة البيانات بين بلد المنشأ وبلد اللجوء.',
      origin_code: 'رمز ISO3 لبلد المنشأ.',
      asylum: 'بلد اللجوء (البلد المضيف).',
      asylum_code: 'رمز ISO3 لبلد اللجوء.',
      year: 'السنة المرجعية للرصد.',
      source: 'معرّف المزوّد الذي قدّم الصف (انظر get_metadata).',
      last_updated: 'وقت جلب الصف أو معالجته على الخادم — سجّله، فالسلاسل الأصلية تخضع للمراجعة.',
      dataset: 'معرّف مجموعة البيانات التي ينتمي إليها الصف.',
      refugees: 'اللاجئون المشمولون بولاية المفوضية، رصيد نهاية العام.',
      asylum_seekers: 'الأشخاص الذين لديهم طلبات لجوء قيد النظر.',
      returned_refugees: 'اللاجئون الذين عادوا خلال العام.',
      idps: 'النازحون داخلياً (المشمولون بحماية المفوضية).',
      returned_idps: 'النازحون داخلياً الذين عادوا خلال العام.',
      resettlement:
        'اللاجئون الذين أُعيد توطينهم في بلد ثالث خلال العام (تدفق). في منظور بلد اللجوء: بلد إعادة التوطين.',
      naturalisation: 'اللاجئون الذين اكتسبوا جنسية بلد اللجوء خلال العام (تدفق).',
      stateless: 'الأشخاص الذين لا يحملون جنسية معترفاً بها.',
      ooc: 'فئات أخرى مشمولة باهتمام المفوضية.',
      oip: 'أشخاص آخرون بحاجة إلى حماية دولية.',
      hst: 'أفراد المجتمعات المضيفة الذين تساعدهم المفوضية.',
      applied: 'طلبات اللجوء الفردية المقدَّمة خلال العام.',
      dec_recognized: 'طلبات اعتُرف فيها بصفة اللاجئ.',
      dec_other: 'منح الحماية التكميلية/الفرعية.',
      dec_rejected: 'طلبات مرفوضة.',
      dec_closed: 'طلبات أُغلقت لأسباب أخرى (سحب الطلب، التخلي عنه...).',
      dec_total: 'جميع القرارات الصادرة خلال العام.',
      national_population: 'إجمالي السكان على المستوى الوطني (البنك الدولي SP.POP.TOTL).',
      gdp_usd: 'الناتج المحلي الإجمالي بالأسعار الجارية (البنك الدولي NY.GDP.MKTP.CD).',
      gdp_per_capita_usd: 'نصيب الفرد من الناتج المحلي الإجمالي بالأسعار الجارية (NY.GDP.PCAP.CD).',
      poverty_rate_pct:
        'نسبة السكان تحت خط الفقر (2.15 دولار يومياً، تعادل القوة الشرائية 2017؛ SI.POV.DDAY).',
      idps_hdx: 'رصيد النازحين داخلياً وفق آخر تقييم خلال العام (لا تُجمع جولات التقييم).',
      events: 'أحداث النزاع خلال العام (مجموع الصفوف الشهرية/حسب نوع الحدث).',
      fatalities: 'الوفيات المبلَّغ عنها جراء النزاع خلال العام.',
      requirements_usd: 'الاحتياجات التمويلية للنداءات، مجموع جميع النداءات سنوياً.',
      funding_usd: 'التمويل المستلَم، مجموع جميع النداءات سنوياً.',
      funding_coverage_pct:
        'funding_usd ÷ requirements_usd × 100، يُعاد حسابه بعد الجمع (ولا يُحسب متوسطاً أبداً).',
      ipc_phase_1: 'عدد الأشخاص في المرحلة 1 من التصنيف المرحلي المتكامل (الحد الأدنى).',
      ipc_phase_2: 'عدد الأشخاص في المرحلة 2 (الضغط).',
      ipc_phase_3: 'عدد الأشخاص في المرحلة 3 (الأزمة).',
      ipc_phase_4: 'عدد الأشخاص في المرحلة 4 (الطوارئ).',
      ipc_phase_5: 'عدد الأشخاص في المرحلة 5 (الكارثة/المجاعة).',
      ipc_phase_3plus: 'عدد الأشخاص في المرحلة 3 فأعلى — الرقم الرئيسي.',
      analyzed_population: 'السكان المشمولون بتحليل التصنيف المرحلي المتكامل.',
      reports: 'تقارير الحالة المنشورة على ريليف ويب عن البلد في تلك السنة.',
      demographics_total: 'إجمالي الأشخاص المشمولين.',
    },
    demographic: (sex: string, ageLabel: string) => `${sex} (${ageLabel}).`,
    headlinePrefix: (text: string) => `الرقم الرئيسي — ${text}`,
    headlineFallback: 'إجمالي خاص بمجموعة البيانات.',
    headline: {
      population:
        'مجموع كل فئات المشمولين بالاهتمام في الصف (اللاجئون + طالبو اللجوء + النازحون داخلياً + عديمو الجنسية + غيرهم).',
      demographics: 'إجمالي الأشخاص المشمولين بالتوزيع حسب العمر والجنس.',
      'asylum-applications': 'طلبات اللجوء المقدَّمة.',
      'asylum-decisions': 'إجمالي القرارات الموضوعية.',
      solutions:
        'مجموع الحلول الدائمة المسجّلة خلال العام (عودة اللاجئين + إعادة التوطين + التجنّس + عودة النازحين داخلياً) — تدفق وليس رصيداً.',
      'context-indicators': 'إجمالي السكان على المستوى الوطني (SP.POP.TOTL).',
      idps: 'النازحون داخلياً (آخر تقييم خلال العام).',
      'conflict-events': 'أحداث النزاع المسجَّلة خلال العام.',
      'humanitarian-funding': 'التمويل الإنساني المستلَم (دولار أمريكي بالأسعار الجارية).',
      'food-security': 'عدد الأشخاص في المرحلة 3 فأعلى (الأزمة أو أسوأ).',
      'situation-reports': 'تقارير الحالة المنشورة عن البلد خلال العام.',
    },
  },
  metadata: {
    headers: ['مجموعة البيانات', 'المؤشرات', 'الوصف'],
    healthHeaders: ['المزوّد', 'الحالة', 'زمن الاستجابة', 'التفاصيل'],
    ok: '✅ يعمل',
    down: '❌ متوقف',
    ms: (v: string) => `${v} ملّي ثانية`,
  },
  errors: {
    countryNotFound: (query: string, suggestions: string | undefined) =>
      `لم يُعثر على بلد يطابق «${query}».${suggestions ? ` هل تقصد: ${suggestions}؟` : ''} جرّب أداة search_country أولاً.`,
    offlineMiss: (detail: string) =>
      `وضع العمل دون اتصال مفعَّل، وهذه البيانات غير مخزَّنة مؤقتاً بعد: ${detail}`,
    rateLimited: (provider: string) =>
      `مزوّد البيانات (${provider}) يحدّ من معدل الطلبات حالياً. أعد المحاولة بعد قليل.`,
    network: (provider: string, detail: string) =>
      `تعذّر الوصول إلى مزوّد البيانات (${provider}): ${detail}`,
    upstream: (provider: string, detail: string) =>
      `أعاد مزوّد البيانات (${provider}) خطأً: ${detail}`,
    defaultProvider: 'البيانات',
    yearRange: (from: string, to: string) =>
      `يجب ألا تكون سنة البداية year_from (${from}) بعد سنة النهاية year_to (${to})`,
    denominatorsUnavailable:
      'يتطلب normalize_by مجموعة البيانات "context-indicators". فعِّل مزوّد البنك الدولي: MALJA_PROVIDERS=unhcr,worldbank',
  },
  prompts: {
    respondIn:
      'اكتب الرد كاملاً بالعربية الفصحى، ومرِّر locale="ar" عند استدعاء الأدوات، واستخدم المصطلحات الإنسانية المعتمدة (لاجئون، طالبو لجوء، نازحون داخلياً، عديمو الجنسية).',
  },
  metrics: {
    refugees: 'اللاجئون',
    asylum_seekers: 'طالبو اللجوء',
    returned_refugees: 'اللاجئون العائدون',
    idps: 'النازحون داخلياً',
    returned_idps: 'النازحون داخلياً العائدون',
    resettlement: 'إعادة التوطين',
    naturalisation: 'التجنّس',
    stateless: 'عديمو الجنسية',
    ooc: 'فئات أخرى مشمولة باهتمام المفوضية',
    oip: 'أشخاص آخرون بحاجة إلى حماية دولية',
    hst: 'المجتمعات المضيفة',
    applied: 'طلبات اللجوء',
    dec_recognized: 'الاعتراف بصفة اللاجئ',
    dec_other: 'الحماية التكميلية',
    dec_rejected: 'الرفض',
    dec_closed: 'الإغلاق لأسباب أخرى',
    dec_total: 'إجمالي القرارات',
    national_population: 'إجمالي السكان',
    gdp_usd: 'الناتج المحلي الإجمالي (دولار أمريكي)',
    gdp_per_capita_usd: 'نصيب الفرد من الناتج المحلي الإجمالي (دولار أمريكي)',
    poverty_rate_pct: 'معدل الفقر (%)',
    events: 'أحداث النزاع',
    fatalities: 'الوفيات',
    requirements_usd: 'الاحتياجات التمويلية (دولار أمريكي)',
    funding_usd: 'التمويل المستلَم (دولار أمريكي)',
    funding_coverage_pct: 'نسبة تغطية التمويل (%)',
    ipc_phase_1: 'المرحلة 1 — الحد الأدنى',
    ipc_phase_2: 'المرحلة 2 — الضغط',
    ipc_phase_3: 'المرحلة 3 — الأزمة',
    ipc_phase_4: 'المرحلة 4 — الطوارئ',
    ipc_phase_5: 'المرحلة 5 — الكارثة/المجاعة',
    ipc_phase_3plus: 'المرحلة 3 فأعلى (الأزمة أو أسوأ)',
    analyzed_population: 'السكان المشمولون بالتحليل',
    reports: 'تقارير الحالة',
    total: 'الإجمالي',
  },
  datasets: {
    population: 'النازحون قسراً وعديمو الجنسية',
    demographics: 'التركيبة الديموغرافية (العمر والجنس)',
    'asylum-applications': 'طلبات اللجوء',
    'asylum-decisions': 'قرارات اللجوء',
    solutions: 'الحلول الدائمة (العودة وإعادة التوطين والتجنّس)',
    'context-indicators': 'مؤشرات سياقية (السكان والناتج المحلي)',
    idps: 'النازحون داخلياً',
    'conflict-events': 'أحداث النزاع',
    'humanitarian-funding': 'التمويل الإنساني',
    'food-security': 'الأمن الغذائي (التصنيف المرحلي المتكامل IPC)',
    'situation-reports': 'تقارير الحالة',
  },
  producers: {
    unhcr: 'المفوضية السامية للأمم المتحدة لشؤون اللاجئين (UNHCR)',
    worldbank: 'البنك الدولي (World Bank)',
    hdx: 'منصة تبادل البيانات الإنسانية (HDX)',
    reliefweb: 'ريليف ويب (ReliefWeb)',
  },
  regions: {
    Africa: 'أفريقيا',
    Asia: 'آسيا',
    Europe: 'أوروبا',
    Oceania: 'أوقيانوسيا',
    'Latin America and the Caribbean': 'أمريكا اللاتينية والبحر الكاريبي',
    'Northern America': 'أمريكا الشمالية',
    Stateless: 'عديمو الجنسية',
    Various: 'متعدد',
    'Middle East & North Africa': 'الشرق الأوسط وشمال أفريقيا',
    'Sub-Saharan Africa': 'أفريقيا جنوب الصحراء الكبرى',
    'Europe & Central Asia': 'أوروبا وآسيا الوسطى',
    'East Asia & Pacific': 'شرق آسيا والمحيط الهادئ',
    'South Asia': 'جنوب آسيا',
    'Latin America & Caribbean': 'أمريكا اللاتينية والبحر الكاريبي',
    'North America': 'أمريكا الشمالية',
  },
};
