import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
class Statement{
 values:any[]=[];
 constructor(public db:SQLiteD1,public sql:string){}
 bind(...values:any[]){if(values.some(x=>x===undefined))throw new Error('D1 bind does not accept undefined');const s=new Statement(this.db,this.sql);s.values=values;return s;}
 execute(){const q=this.db.sqlite.prepare(this.sql);if(q.columns().length){const results=q.all(...this.values);return {success:true,results,meta:{changes:this.db.sqlite.prepare('SELECT changes() n').get()!.n}};}const r=q.run(...this.values);return {success:true,results:[],meta:{changes:Number(r.changes)}};}
 async run(){return this.execute();}
 async all(){return this.execute();}
 async first(column?:string){const r=this.db.sqlite.prepare(this.sql).get(...this.values)??null;return column?r?.[column]:r;}
}
export class SQLiteD1{
 sqlite=new DatabaseSync(':memory:');failOnce:string|null=null;
 constructor(){for(const file of ['0001_ticket.sql','0002_reliability.sql','0003_retention.sql'])this.sqlite.exec(readFileSync(new URL(`../migrations/${file}`,import.meta.url),'utf8'));this.sqlite.exec(readFileSync(new URL('../../../scripts/demo.sql',import.meta.url),'utf8'));}
 prepare(sql:string){return new Statement(this,sql);}
 async batch(statements:Statement[]){this.sqlite.exec('BEGIN IMMEDIATE');try{const out=statements.map(s=>{if(this.failOnce&&s.sql.includes(this.failOnce)){this.failOnce=null;throw new Error('Injected database failure');}return s.execute();});this.sqlite.exec('COMMIT');return out;}catch(e){this.sqlite.exec('ROLLBACK');throw e;}}
 async exec(sql:string){this.sqlite.exec(sql);return {count:1,duration:0};}
 rows(sql:string){return this.sqlite.prepare(sql).all() as any[];}
}
