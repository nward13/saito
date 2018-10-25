var fs = require('fs-extra');


let data = "";
let filename = __dirname + "/prestige.txt";

console.log(filename);

if (fs.existsSync(filename)) {
  data = fs.readFileSync(filename, 'utf8');
  words = data.split(" ");
  for (let z = 0; z < words.length; z++) {
    words[z] = words[z].toLowerCase();
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


for (let i = 0; i < uniq.length; i++) {
  console.log(uniq[i]);
}


