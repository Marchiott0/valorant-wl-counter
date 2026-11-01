import { EventEmitter } from 'node:events';
import { HenrikClient, ApiError } from './henrik.mjs';
import { dayKey, countMatches } from './matches.mjs';
import { validateConfig } from './storage.mjs';

export class CounterEngine extends EventEmitter {
  constructor(storage,{now=Date.now,clientFactory=options=>new HenrikClient(options)}={}) {
    super(); this.storage=storage; this.now=now; this.clientFactory=clientFactory; this.inflight=null; this.generation=0; this.failureCount=0; this.account=null; this.lastRequest=0; this.key=''; this.state={};
  }
  identity(config=this.config) {return JSON.stringify([config.region,config.platform,config.timeZone,config.riotId.toLocaleLowerCase('en-US')]);}
  async init() {
    await this.storage.init(); this.config=await this.storage.loadConfig(); this.key=await this.storage.loadKey();
    this.client=this.key ? this.clientFactory({apiKey:this.key}) : null;
    this.resetDay();
    const saved=await this.storage.loadState();
    if(saved?.identity===this.identity() && saved.day===this.state.day && saved.known===true && saved.complete===true && Number.isInteger(saved.wins) && saved.wins>=0 && Number.isInteger(saved.losses) && saved.losses>=0 && Number.isFinite(Date.parse(saved.lastSuccess))) {
      Object.assign(this.state,{wins:saved.wins,losses:saved.losses,known:true,complete:true,lastSuccess:saved.lastSuccess,status:'stale',message:'Última contagem salva. Aguardando confirmação da API.'});
    }
    if(this.storage.warning) this.state.message=this.storage.warning;
    return this;
  }
  resetDay() {
    this.state={day:dayKey(this.now(),this.config.timeZone),wins:0,losses:0,known:false,complete:false,status:this.config?.riotId && this.key ? 'waiting' : 'unconfigured',message:this.config?.riotId && this.key ? 'Aguardando consulta do histórico de hoje.' : 'Informe a conta e a chave HenrikDev para começar.',lastSuccess:null,lastAttempt:null,nextPoll:null,ignored:0};
    this.lastRequest=0;
  }
  checkDay() {
    if(this.state.day!==dayKey(this.now(),this.config.timeZone)) {this.generation++; this.resetDay(); this.emitState(); return true;} return false;
  }
  publicConfig() {return {...this.config,style:{...this.config.style},hasApiKey:Boolean(this.key)};}
  getState() {this.checkDay();return {...this.state,style:{...this.config.style},configured:Boolean(this.config.riotId&&this.key),timeZone:this.config.timeZone};}
  emitState() {this.emit('state',{...this.state,style:{...this.config.style},configured:Boolean(this.config.riotId&&this.key),timeZone:this.config.timeZone});}
  async configure(input) {
    const updated=validateConfig(input,this.config);
    const newKey=typeof input.apiKey==='string' ? input.apiKey.trim() : '';
    const identityChanged=this.identity(updated)!==this.identity();
    const credentialsChanged=identityChanged || (Boolean(newKey)&&newKey!==this.key);
    const frequencyChanged=updated.pollSeconds!==this.config.pollSeconds;
    await this.storage.saveConfig(updated,newKey);
    this.config=updated;
    if(newKey) this.key=newKey;
    if(credentialsChanged) {
      this.generation++; this.account=null; this.lastRequest=0; this.failureCount=0;
      this.client=this.key ? this.clientFactory({apiKey:this.key}) : null;
      if(identityChanged) this.resetDay();
      this.state.nextPoll=null;
      this.state.status=this.key && updated.riotId ? 'waiting' : 'unconfigured';
      this.state.message=this.key && updated.riotId ? 'Configuração salva. Pronto para consultar.' : 'Informe a conta e a chave HenrikDev para começar.';
    }
    if(frequencyChanged && !credentialsChanged && this.state.nextPoll && !this.failureCount && this.lastRequest) {
      this.state.nextPoll=new Date(Math.max(this.now(),this.lastRequest+updated.pollSeconds*1000)).toISOString();
    }
    this.emitState();
    return this.publicConfig();
  }
  refresh() {
    this.checkDay();
    if(this.inflight) return this.inflight;
    if(!this.config.riotId || !this.key) return Promise.resolve(this.getState());
    if(this.lastRequest && this.now()<Date.parse(this.state.nextPoll)) return Promise.resolve(this.getState());
    const run=this.performRefresh();
    this.inflight=run.finally(()=>{this.inflight=null;});
    return this.inflight;
  }
  async performRefresh() {
    const generation=this.generation;
    const config=this.config;
    const client=this.client;
    const date=this.state.day;
    this.lastRequest=this.now();
    this.state.lastAttempt=new Date(this.now()).toISOString();
    this.state.status='updating'; this.state.message='Consultando as partidas competitivas de hoje…';this.emitState();
    let nextDelay=this.config.pollSeconds*1000;
    try {
      const separator=config.riotId.lastIndexOf('#');
      const name=config.riotId.slice(0,separator),tag=config.riotId.slice(separator+1);
      const account=this.account ?? await client.getAccount(name,tag);
      if(generation!==this.generation || date!==dayKey(this.now(),config.timeZone)) return this.getState();
      if(!account?.puuid) throw new Error('account');
      this.account=account;
      const history=await client.getDailyMatches({name,tag,region:config.region,platform:config.platform,timeZone:config.timeZone,puuid:account.puuid,now:this.now()});
      if(generation!==this.generation || date!==dayKey(this.now(),config.timeZone)) return this.getState();
      const result=countMatches(history.matches,{puuid:account.puuid,day:date,now:this.now(),timeZone:config.timeZone});
      if(!history.complete || result.uncertain>0) {
        this.state.complete=false;this.state.status='incomplete';
        this.state.message='Histórico incompleto ou com resultados inconsistentes. A última contagem confirmada foi mantida; sem confirmação anterior, o overlay exibe traços.';
      } else {
        const valid={identity:this.identity(config),day:date,wins:result.wins,losses:result.losses,known:true,complete:true,lastSuccess:new Date(this.now()).toISOString()};
        await this.storage.saveState(valid);
        if(generation!==this.generation || date!==dayKey(this.now(),config.timeZone)) return this.getState();
        Object.assign(this.state,{wins:valid.wins,losses:valid.losses,known:true,complete:true,lastSuccess:valid.lastSuccess,status:'ready',ignored:result.ignored,message:'Contagem confirmada. Novas partidas aparecem quando a API disponibilizar os resultados.'});
      }
      this.failureCount=0;
      nextDelay=this.config.pollSeconds*1000;
    } catch(error) {
      if(generation!==this.generation || date!==dayKey(this.now(),config.timeZone)) return this.getState();
      this.failureCount++;
      nextDelay=Math.max(Math.min(this.config.pollSeconds*1000*2**Math.min(this.failureCount-1,5),900000),Number(error?.retryAfterMs)||0);
      this.state.status=this.state.known ? 'stale' : 'error';
      this.state.message=error instanceof ApiError ? error.message : 'Não foi possível atualizar ou salvar os dados. A última contagem válida foi mantida. Verifique a conexão e o espaço em disco.';
    } finally {
      if(generation===this.generation && date===dayKey(this.now(),config.timeZone)) this.state.nextPoll=new Date(this.now()+nextDelay).toISOString();
      this.checkDay();this.emitState();
    }
    return this.getState();
  }
  start() {
    if(this.timer) return;
    this.timer=setInterval(()=>{this.checkDay(); if(!this.state.nextPoll || this.now()>=Date.parse(this.state.nextPoll)) void this.refresh().catch(()=>{});},1000);
    this.timer.unref();void this.refresh().catch(()=>{});
  }
  stop() {clearInterval(this.timer);this.timer=null;}
}
