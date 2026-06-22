import winkNLP from "wink-nlp";
import model from "wink-eng-lite-web-model";

const nlp = winkNLP(model);
const doc = nlp.readDoc("This is a test of the test.");
const tokens = doc.tokens().out();
console.log(tokens);
// Try to get offset
// @ts-ignore
console.log(doc.tokens().out(nlp.its.span));
