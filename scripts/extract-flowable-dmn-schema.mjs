// Generates schema/flowable-dmn-<version>.json from the Flowable DMN model and converter sources at a release tag.
//
//   node scripts/extract-flowable-dmn-schema.mjs [--tag flowable-7.2.0] [--out schema/flowable-dmn-7.2.0.json] [--cache <dir>]
//
// Only what the editor needs is extracted: the enum values the engine accepts for hitPolicy and aggregation (from
// the HitPolicy and BuiltinAggregator enums) and the element/attribute names of the decision table (from
// DmnXMLConstants), so the editor never carries hand-typed lists.
import fs from 'node:fs';
import path from 'node:path';

const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const TAG = arg('tag', 'flowable-7.2.0');
const OUT = arg('out', `schema/flowable-dmn-${TAG.replace(/^flowable-/, '')}.json`);
const CACHE = arg('cache', null);
const RAW = `https://raw.githubusercontent.com/flowable/flowable-engine/${TAG}/modules`;

async function get(url) {
  const file = CACHE && path.join(CACHE, 'dmn_' + url.split('/').slice(-1)[0]);
  if (file && fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const text = await res.text();
  if (file) {
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(file, text);
  }
  return text;
}

// enum constants look like  NAME("value")
const enumValues = (src) => [...src.matchAll(/^\s*\w+\("([^"]*)"\)\s*[,;]/gm)].map((m) => m[1]);

const hitPolicy = enumValues(await get(`${RAW}/flowable-dmn-model/src/main/java/org/flowable/dmn/model/HitPolicy.java`));
const aggregation = enumValues(await get(`${RAW}/flowable-dmn-model/src/main/java/org/flowable/dmn/model/BuiltinAggregator.java`));
const constants = await get(`${RAW}/flowable-dmn-xml-converter/src/main/java/org/flowable/dmn/xml/constants/DmnXMLConstants.java`);
const consts = Object.fromEntries([...constants.matchAll(/String (\w+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]));
const pick = (prefix, names) => names.map((n) => consts[`${prefix}_${n}`]).filter(Boolean);

if (!hitPolicy.length || !aggregation.length) throw new Error('could not read the hit policy / aggregation enums');

const schema = {
  engine: 'flowable-community-dmn',
  version: TAG.replace(/^flowable-/, ''),
  source: `https://github.com/flowable/flowable-engine/tree/${TAG}/modules/flowable-dmn-model`,
  generatedBy: 'scripts/extract-flowable-dmn-schema.mjs',
  decisionTable: {
    attributes: {
      hitPolicy: { type: 'enum', values: hitPolicy },
      aggregation: { type: 'enum', values: aggregation, onlyWhen: { hitPolicy: 'COLLECT' } },
    },
    elements: {
      decisionTable: consts.ELEMENT_DECISION_TABLE,
      input: consts.ELEMENT_INPUT_CLAUSE,
      inputExpression: consts.ELEMENT_INPUT_EXPRESSION,
      inputValues: consts.ELEMENT_INPUT_VALUES,
      output: consts.ELEMENT_OUTPUT_CLAUSE,
      outputValues: consts.ELEMENT_OUTPUT_VALUES,
      rule: consts.ELEMENT_RULE,
      inputEntry: consts.ELEMENT_INPUT_ENTRY,
      outputEntry: consts.ELEMENT_OUTPUT_ENTRY,
      description: consts.ELEMENT_DESCRIPTION,
      text: consts.ELEMENT_TEXT,
    },
    clauseAttributes: pick('ATTRIBUTE', ['ID', 'LABEL', 'NAME', 'TYPE_REF']),
  },
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(schema, null, 2) + '\n');
console.log(`wrote ${OUT}: hitPolicy=${hitPolicy.join('|')} aggregation=${aggregation.join('|')}`);
