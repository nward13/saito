



console.log("START: " + new Date().getTime());

let msg = "This is a string";

for (i = 0; i < 10000; i++) {

  let msg2 = Buffer.from(msg, 'utf-8').toString('base64');

}
console.log("STOP:  " + new Date().getTime());



