var fs = require('fs-extra');


let data = "";
let filename = __dirname + "/dict1.txt";

if (fs.existsSync(filename)) {
  data = fs.readFileSync(filename, 'utf8');
  words = data.split("\n");

  for (let i = 0; i < words.length; i++) {
   if (words[i].length < 4) {
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


