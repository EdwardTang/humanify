
function a(b){return b.charAt(0).toUpperCase()+b.slice(1)}
var c=["hello","world"];
var d={};for(var e=0;e<c.length;e++){var f=c[e];d[f]=a(f)}console.log(d);
