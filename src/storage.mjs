import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

export const DEFAULT_STYLE = Object.freeze({fontFamily:'Segoe UI',fontSize:64,winColor:'#4ade80',lossColor:'#fb7185',textColor:'#ffffff'});
export const DEFAULT_CONFIG = Object.freeze({riotId:'',region:'br',platform:'pc',timeZone:'America/Sao_Paulo',pollSeconds:60,style:DEFAULT_STYLE});
export const REGIONS = ['br','latam','na','eu','ap','kr'];
const FONTS = ['Segoe UI','Arial','Consolas','Trebuchet MS'];

export function validateConfig(input, current = DEFAULT_CONFIG) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Configuração inválida.');
  const riotId = String(input.riotId ?? current.riotId).trim();
  if (riotId && (!/^[^#\r\n\x00-\x1f]{1,64}#[^#\s\x00-\x1f]{1,16}$/u.test(riotId))) throw new Error('Informe o Riot ID no formato Nome#TAG.');
  const region = input.region ?? current.region;
  if (!REGIONS.includes(region)) throw new Error('Selecione uma região válida.');
  const platform = input.platform ?? current.platform ?? DEFAULT_CONFIG.platform;
  if (!['pc','console'].includes(platform)) throw new Error('Selecione uma plataforma válida.');
  const timeZone = input.timeZone ?? current.timeZone ?? DEFAULT_CONFIG.timeZone;
  if (typeof timeZone !== 'string' || timeZone.length > 100 || !timeZone.trim()) throw new Error('Informe um fuso horário válido.');
  try { new Intl.DateTimeFormat('pt-BR',{timeZone}).format(); } catch { throw new Error('Informe um fuso horário válido.'); }
  const pollSeconds = input.pollSeconds ?? current.pollSeconds ?? DEFAULT_CONFIG.pollSeconds;
  if (!Number.isInteger(pollSeconds) || pollSeconds < 30 || pollSeconds > 300) throw new Error('A frequência deve ser de 30 a 300 segundos.');
  const style = {...DEFAULT_STYLE,...current.style};
  if (input.style !== undefined) {
    if (!input.style || typeof input.style !== 'object' || Array.isArray(input.style)) throw new Error('Aparência inválida.');
    for (const key of Object.keys(DEFAULT_STYLE)) if (input.style[key] !== undefined) style[key] = input.style[key];
  }
  if (!FONTS.includes(style.fontFamily)) throw new Error('Selecione uma fonte disponível.');
  if (!Number.isInteger(style.fontSize) || style.fontSize < 16 || style.fontSize > 160) throw new Error('O tamanho da fonte deve ficar entre 16 e 160.');
  for (const key of ['winColor','lossColor','textColor']) if (!/^#[0-9a-f]{6}$/i.test(style[key])) throw new Error('Use cores no formato hexadecimal.');
  if (input.apiKey !== undefined && (typeof input.apiKey !== 'string' || input.apiKey.length > 4096 || /[\r\n\x00]/.test(input.apiKey))) throw new Error('Chave da API inválida.');
  return {riotId,region,platform,timeZone,pollSeconds,style};
}

export async function atomicJson(path, value) {
  const temp = `${path}.tmp`;
  await writeFile(temp, `${JSON.stringify(value,null,2)}\n`, {mode:0o600});
  await rename(temp,path);
}

async function dpapi(value, decrypt = false) {
  if (process.platform !== 'win32') throw new Error('A proteção da chave requer Windows.');
  const script = `Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($v); $r=[Security.Cryptography.ProtectedData]::${decrypt ? 'Unprotect' : 'Protect'}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  return new Promise((resolve,reject) => {
    const child = spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output = '';
    const timer = setTimeout(() => {child.kill(); reject(new Error('A proteção de credenciais do Windows não respondeu.'));},15000);
    child.stdout.on('data',chunk => {output += chunk;});
    child.stderr.resume();
    child.stdin.on('error',()=>{});
    child.on('error',()=>{clearTimeout(timer); reject(new Error('Não foi possível acessar a proteção de credenciais do Windows.'));});
    child.on('close',code=>{
      clearTimeout(timer);
      if(code !== 0 || !/^[a-zA-Z0-9+/=]+$/.test(output)) return reject(new Error('Não foi possível proteger ou recuperar a chave neste usuário do Windows.'));
      resolve(Buffer.from(output,'base64'));
    });
    child.stdin.end(Buffer.from(value).toString('base64'));
  });
}

export class Storage {
  constructor(directory,{protect=dpapi,unprotect=value=>dpapi(value,true)}={}) {this.directory=directory;this.protect=protect;this.unprotect=unprotect;this.warning=null;}
  async init() {await mkdir(this.directory,{recursive:true,mode:0o700}); await chmod(this.directory,0o700).catch(()=>{});}
  async readJson(name) {
    try {return JSON.parse(await readFile(join(this.directory,name),'utf8'));}
    catch(error) {if(error.code !== 'ENOENT') this.warning='Um arquivo local não pôde ser recuperado. Confira a configuração e sincronize novamente.'; return null;}
  }
  async loadConfig() {
    const saved = await this.readJson('config.json');
    try {return validateConfig(saved ?? DEFAULT_CONFIG);} catch {this.warning='A configuração local estava inválida. Configure a conta novamente.'; return structuredClone(DEFAULT_CONFIG);}
  }
  async loadKey() {
    try {return (await this.unprotect(await readFile(join(this.directory,'api-key.dpapi')))).toString('utf8');}
    catch(error) {if(error.code !== 'ENOENT') this.warning='A chave salva não pôde ser aberta. Informe a chave novamente neste usuário do Windows.'; return '';}
  }
  async saveConfig(config,apiKey) {
    if(apiKey) {
      const encrypted = await this.protect(Buffer.from(apiKey.trim(),'utf8'));
      const path = join(this.directory,'api-key.dpapi');
      await writeFile(`${path}.tmp`,encrypted,{mode:0o600});
      await rename(`${path}.tmp`,path);
    }
    await atomicJson(join(this.directory,'config.json'),config);
  }
  async loadState() {return this.readJson('state.json');}
  async saveState(state) {await atomicJson(join(this.directory,'state.json'),state);}
}
