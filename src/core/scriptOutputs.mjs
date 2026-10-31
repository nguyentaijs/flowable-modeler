// Variable names a script task declares: its resultVariable, and the literal names passed to setVariable(...).
// Names built in code are not found; the run view also uses variable timing for those.
export function scriptOutputNames(script, resultVariable) {
  const names = new Set();
  if (resultVariable) names.add(resultVariable);
  for (const m of String(script || '').matchAll(/setVariable\s*\(\s*(['"])([^'"]+)\1/g)) names.add(m[2]);
  return [...names];
}
