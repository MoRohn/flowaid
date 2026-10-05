---
"@flowaid/ui": patch
"@flowaid/web": patch
---

Expression fields offer references. A step setting written in FlowExpr (a Transform's expression,
an Assert's condition, a Filter's predicate) was a "JavaScript" code box with no help. It is now an
expression editor: typing a step's id and a dot offers its outputs, `$vars.` the workflow settings,
and every function with its arguments; a reference the step cannot read is underlined with what to
write instead, and a syntax error shows under the field. `FlowExprEditor`, `flowExprCompletions`
and `checkExpression` are exported from `@flowaid/ui/forms`.
