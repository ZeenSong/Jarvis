import test from "node:test";
import assert from "node:assert/strict";
import { listDataSchema } from "../packages/ui-protocol-v2/src/list.js";

test("list presentation validates bounds and does not retain executable fields", () => {
  assert.deepEqual(listDataSchema.parse({items:[{title:"result.json",status:"application/json",url:"javascript:alert(1)",action:{type:"delete"}}]}), {items:[{title:"result.json",status:"application/json"}]});
  assert.equal(listDataSchema.safeParse({items:[]}).success,true);
  assert.equal(listDataSchema.safeParse({items:[{title:""}]}).success,false);
  assert.equal(listDataSchema.safeParse({items:Array.from({length:201},()=>({title:"x"}))}).success,false);
});
