/** Error-only diagnostics: never stacks, URLs, identities, tokens or payloads. */
export function browserErrorDiagnostic(error, secrets = []) {
 const allowed=new Set(['Error','TypeError','ReferenceError','SyntaxError','RangeError','DOMException']);
 const name=allowed.has(error?.name)?error.name:'Error';
 let message=String(error?.message||'Browser exception');
 for(const secret of secrets.filter(s=>typeof s==='string'&&s).sort((a,b)=>b.length-a.length))message=message.split(secret).join('[redacted]');
 if(/^\s*[\[{]/.test(message))message='Structured error payload omitted';
 message=message.replace(/https?:\/\/[^\s"'<>]+/gi,'[url omitted]')
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email omitted]')
  .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi,'[id omitted]')
  .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[token omitted]');
 return {name,message:message.slice(0,400)};
}
