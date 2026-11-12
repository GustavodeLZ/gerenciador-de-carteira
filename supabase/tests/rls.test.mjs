import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const db = new PGlite();
// stubs mínimos do Supabase
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('aal', current_setting('request.jwt.claim.aal', true)) $$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to authenticated, anon;
`);
for (const f of ["0001_init.sql","0002_moeda_e_notas.sql"]) await db.exec(fs.readFileSync(new URL("../migrations/"+f, import.meta.url),"utf8"));
// Sem permissões automáticas: simula "Automatically expose new tables" DESLIGADO.
// Tudo o que funciona aqui vem dos GRANTs explícitos das migrações.
const ok=(m)=>console.log("OK  ",m), bad=(m)=>{console.log("FAIL",m);process.exitCode=1};
// allowlist
try{ await db.exec(`insert into auth.users(email) values ('x@x.com')`); bad("cadastro sem allowlist passou"); }catch(e){ ok("bloqueia e-mail fora da allowlist"); }
await db.exec(`insert into public.emails_permitidos values ('eu@x.com'),('outro@x.com')`);
const u1=(await db.query(`insert into auth.users(email) values ('EU@x.com') returning id`)).rows[0].id;
const u2=(await db.query(`insert into auth.users(email) values ('outro@x.com') returning id`)).rows[0].id;
ok("permite e-mail da allowlist (case-insensitive)");
async function as(uid, aal, sql, params){
  await db.exec(`reset role`);
  await db.query(`select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.aal',$2,false)`,[uid,aal]);
  await db.exec(`set role authenticated`);
  try { return await db.query(sql, params); } finally { await db.exec(`reset role`); }
}
const a1=(await as(u1,'aal2',`insert into ativos(ticker,classe) values('ITUB4','acao') returning id`)).rows[0].id;
await as(u1,'aal2',`insert into operacoes(ativo_id,tipo,data,quantidade,preco) values($1,'compra','2024-01-01',100,30)`,[a1]);
ok("dono com aal2 grava ativo e operação");
let r=await as(u1,'aal1',`select * from ativos`); r.rows.length===0?ok("sem 2FA (aal1) vê zero linhas"):bad("aal1 viu dados");
try{ await as(u1,'aal1',`insert into ativos(ticker,classe) values('X','acao')`); bad("aal1 gravou"); }catch{ ok("sem 2FA não grava"); }
r=await as(u2,'aal2',`select * from ativos`); r.rows.length===0?ok("outro usuário não vê meus ativos"):bad("vazou entre usuários");
r=await as(u2,'aal2',`select * from operacoes`); r.rows.length===0?ok("outro usuário não vê minhas operações"):bad("vazou ops");
try{ await as(u2,'aal2',`insert into operacoes(ativo_id,tipo,data,quantidade) values($1,'compra','2024-01-01',1)`,[a1]); bad("u2 pendurou operação no ativo de u1"); }catch(e){ ok("não dá para gravar em ativo alheio: "+e.message.slice(0,30)); }
try{ await as(u2,'aal2',`insert into ativos(user_id,ticker,classe) values($1,'Y','acao')`,[u1]); bad("u2 criou ativo em nome de u1"); }catch{ ok("não dá para criar dado em nome de outro"); }
r=await as(u2,'aal2',`update ativos set ticker='HACK' where id=$1 returning id`,[a1]); r.rows.length===0?ok("não altera dado alheio"):bad("alterou alheio");
try{ await as(u1,'aal2',`insert into cotacoes values('ITUB4','2026-11-10',35)`); bad("usuário gravou cotação"); }catch{ ok("usuário não grava cotação"); }
await db.exec(`set role service_role; insert into cotacoes values('ITUB4','2026-11-10',35),('ITUB4','2026-11-11',36); reset role;`);
r=await as(u2,'aal2',`select * from cotacoes_atuais`); r.rows.length===1&&Number(r.rows[0].fechamento)===36?ok("cotação atual visível com 2FA"):bad("view cotacoes "+JSON.stringify(r.rows));
r=await as(u2,'aal1',`select * from cotacoes`); r.rows.length===0?ok("cotações exigem 2FA"):bad("cotacoes sem 2FA");
try{ await as(u1,'aal2',`select * from tickers_para_cotar()`); bad("usuário chamou tickers_para_cotar"); }catch{ ok("tickers_para_cotar só para o servidor"); }
await db.exec(`set role service_role`); r=await db.query(`select * from tickers_para_cotar()`); await db.exec(`reset role`);
r.rows.length===1?ok("servidor lista tickers"):bad("tickers");
try{ await as(u1,'aal2',`select * from emails_permitidos`).then(x=>x.rows.length===0?ok("allowlist invisível pela API"):bad("allowlist visível")); }catch{ ok("allowlist invisível pela API"); }
// segmentos
const s1=(await as(u1,'aal2',`insert into segmentos(nome) values('Dividendos') returning id`)).rows[0].id;
await as(u1,'aal2',`insert into segmento_ativos(segmento_id,ativo_id,meta_pct) values($1,$2,30)`,[s1,a1]); ok("vincula ativo ao segmento");
const a2=(await as(u2,'aal2',`insert into ativos(ticker,classe) values('PETR4','acao') returning id`)).rows[0].id;
try{ await as(u2,'aal2',`insert into segmento_ativos(segmento_id,ativo_id) values($1,$2)`,[s1,a2]); bad("u2 usou segmento de u1"); }catch{ ok("não usa segmento alheio"); }
r=await as(u2,'aal2',`select * from segmento_ativos`); r.rows.length===0?ok("vínculos isolados"):bad("vinculos vazaram");

// 0002: moeda, câmbio e origem
const us=(await as(u1,'aal2',`insert into ativos(ticker,classe,moeda) values('GOOG','exterior','USD') returning id`)).rows[0].id;
await as(u1,'aal2',`insert into operacoes(ativo_id,tipo,data,quantidade,preco,cambio,origem) values($1,'compra','2026-11-09',0.0695,287.71,5.1,'dw:abc')`,[us]);
ok("grava operação em dólar com câmbio e origem");
r=await as(u1,'aal2',`insert into operacoes(ativo_id,tipo,data,quantidade,preco,origem) values($1,'compra','2026-11-09',0.0695,287.71,'dw:abc') on conflict (user_id,origem) do nothing returning id`,[us]);
r.rows.length===0?ok("mesma nota não é importada duas vezes"):bad("duplicou origem");
await as(u1,'aal2',`insert into operacoes(ativo_id,tipo,data,quantidade,preco) values($1,'compra','2026-11-10',1,1),($1,'compra','2026-11-10',1,1)`,[us]);
ok("operações manuais (sem origem) não conflitam");
const usB=(await as(u2,'aal2',`insert into ativos(ticker,classe,moeda) values('GOOG','exterior','USD') returning id`)).rows[0].id;
await as(u2,'aal2',`insert into operacoes(ativo_id,tipo,data,quantidade,preco,origem) values($1,'compra','2026-11-09',1,1,'dw:abc')`,[usB]);
ok("mesma origem em outro usuário não conflita nem vaza");
try{ await as(u1,'aal2',`insert into ativos(ticker,classe,moeda) values('X1','acao','EUR')`); bad("aceitou moeda inválida"); }catch{ ok("rejeita moeda inválida"); }
await db.exec(`set role service_role`); r=await db.query(`select * from tickers_para_cotar() order by ticker`); await db.exec(`reset role`);
JSON.stringify(r.rows).includes('"moeda":"USD"')?ok("rotina diária recebe tickers com moeda"):bad("tickers sem moeda "+JSON.stringify(r.rows));

// permissões explícitas
try{ await as(u1,'aal2',`select * from emails_permitidos`); bad("allowlist acessível"); }catch{ ok("allowlist sem permissão pela API"); }
await db.exec(`set role anon`); try{ await db.query(`select * from cotacoes`); bad("anon leu cotações"); }catch{ ok("anônimo não lê nada"); } await db.exec(`reset role`);
