const read = (p) => p;
export const COMMANDS = {
  collect: () => 'collect.json',
  context: (o) => [read('agents/_contract.md'), read(`agents/${o.area}.md`)].join('\n'),
  merge: () => 'findings.json',
};
