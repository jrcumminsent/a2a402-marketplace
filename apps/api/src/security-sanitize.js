const CONNECTION_URI=/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"'<>]+/gi;
const URI_WITH_PASSWORD=/\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)([^@\s/]+)(@[^\s"'<>]+)/gi;
const ENV_SECRET=/\b(DATABASE_URL|SUPABASE_DB_URL|POSTGRES_URL|PRIVATE_KEY|SECRET_KEY|API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|AUTH_TOKEN)\s*[=:]\s*([^\s,;]+)/gi;
const BEARER=/\bBearer\s+[A-Za-z0-9._~+\/-]{20,}={0,2}\b/gi;

export function redactSecretString(value){
  let text=String(value);
  text=text.replace(CONNECTION_URI,uri=>uri.replace(URI_WITH_PASSWORD,'$1[REDACTED]$3'));
  text=text.replace(URI_WITH_PASSWORD,'$1[REDACTED]$3');
  text=text.replace(ENV_SECRET,'$1=[REDACTED]');
  text=text.replace(BEARER,'Bearer [REDACTED]');
  return text;
}

export function deepRedactSecrets(value,seen=new WeakSet()){
  if(typeof value==='string')return redactSecretString(value);
  if(value===null||typeof value!=='object')return value;
  if(seen.has(value))return value;
  seen.add(value);
  if(Array.isArray(value))return value.map(item=>deepRedactSecrets(item,seen));
  const out={};
  for(const [key,item] of Object.entries(value)){
    if(/^(password|passwd|privateKey|private_key|secret|secretKey|secret_key)$/i.test(key))out[key]='[REDACTED]';
    else out[key]=deepRedactSecrets(item,seen);
  }
  return out;
}

export function containsLikelySecret(value){
  const text=typeof value==='string'?value:JSON.stringify(value??null);
  if(!text)return false;
  URI_WITH_PASSWORD.lastIndex=0; CONNECTION_URI.lastIndex=0; ENV_SECRET.lastIndex=0; BEARER.lastIndex=0;
  const connection=CONNECTION_URI.test(text)&&/\w+:\/\/[^\s:@/]+:[^@\s/]+@/.test(text);
  CONNECTION_URI.lastIndex=0;
  return connection||ENV_SECRET.test(text)||BEARER.test(text);
}
