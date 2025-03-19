#!/bin/bash

mkdir -p test/fixtures
cat > test/fixtures/minified.js << 'EOL'
function a(b,c){for(var d=0,e=b.length;d<e;d++){var f=b[d];if(f.test(c))return f.value}return null}
var g={h:function(b){return/^[A-Z]/.test(b)},i:function(b){return/^[a-z]/.test(b)}};
function j(b){var c=a([{test:g.h,value:"uppercase"},{test:g.i,value:"lowercase"}],b);return c||"unknown"}
var k=["apple","Banana","cherry","Date"];
var l={};for(var d=0;d<k.length;d++){var m=k[d];l[m]=j(m)}console.log(l);
EOL 