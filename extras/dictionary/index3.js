var fs = require('fs-extra');


let data = "";
let filename = __dirname + "/dict7.txt";

if (fs.existsSync(filename)) {
  data = fs.readFileSync(filename, 'utf8');
  words = data.split("\n");

  for (let i = 0; i < words.length; i++) {
    if ( words[i][words[i].length-1] == 'g' &&
         words[i][words[i].length-2] == 'n' &&
         words[i][words[i].length-3] == 'n') {
      words[i] = "";
    }
  }

  words.sort();

}



var uniq = words.slice() // slice makes copy of array before sorting it
  .sort(function(a,b){
    return a > b;
  })
  .reduce(function(a,b){
    if (a.slice(-1)[0] !== b) a.push(b); // slice(-1)[0] means last item in array without removing it (like .pop())
    return a;
},[]);

uniq.sort();



var uniq2 = uniq.slice() // slice makes copy of array before sorting it
  .sort(function(a,b){
    return a > b;
  })
  .reduce(function(a,b){
    if (a.slice(-1)[0] !== b) a.push(b); // slice(-1)[0] means last item in array without removing it (like .pop())
    return a;
},[]);



for (let i = 0; i < uniq2.length; i++) {
  console.log(uniq2[i]);
}


