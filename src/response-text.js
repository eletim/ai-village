// Presentation only: never mutate the native record or infer intent from its words.
export function responseText(entry){
 const output=entry.output||'',final=entry.finalOutput||'';
 const hasFinal=!!final.trim();
 const suffix=hasFinal&&output.trimEnd().endsWith(final.trimEnd());
 return {answer:hasFinal?final:output,record:hasFinal?(suffix?output.trimEnd().slice(0,-final.trimEnd().length).trimEnd():output):'',recordLabel:suffix?'途中経過':'詳細'};
}
