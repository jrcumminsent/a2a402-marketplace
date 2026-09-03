import { withEconomy } from '../../apps/api/src/persistence.js';
import { buildEconomicGraph } from '../../apps/api/src/economic-graph.js';

const headers={
  'content-type':'application/json; charset=utf-8',
  'access-control-allow-origin':'*',
  'access-control-allow-methods':'GET,OPTIONS'
};
const reply=(statusCode,value)=>({statusCode,headers,body:JSON.stringify(value)});

export async function handler(event){
  try{
    if(event.httpMethod==='OPTIONS')return{statusCode:204,headers,body:''};
    if(event.httpMethod!=='GET')return reply(405,{error:'method not allowed'});
    return await withEconomy(async economy=>reply(200,buildEconomicGraph(economy)));
  }catch(error){
    return reply(400,{error:error.message});
  }
}
