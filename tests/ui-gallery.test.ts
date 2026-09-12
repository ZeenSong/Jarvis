import test from "node:test";
import assert from "node:assert/strict";
import { galleryDataSchema, mediaPathSchema } from "../packages/ui-protocol-v2/src/gallery.js";
test("gallery accepts gateway media only, rejecting URL credentials and traversal",()=>{
  assert.equal(mediaPathSchema.safeParse("/api/media/photo-1/thumbnail").success,true);
  for(const path of ["https://example.com/a.jpg","//example.com/a","/api/media/../thumbnail","/api/media/id/thumbnail?token=secret","data:image/svg+xml,abc"]) assert.equal(mediaPathSchema.safeParse(path).success,false);
  assert.equal(galleryDataSchema.safeParse({items:[{id:"one",title:"照片",thumbnail:"/api/media/one/thumbnail"},{id:"one",title:"重复",thumbnail:"/api/media/one/thumbnail"}]}).success,false);
});
