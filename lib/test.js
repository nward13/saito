
  let diff = 0.08;
  let random = "0.5327941673516474";
  let target = "35966d61dd42ad39bda07759572209e60b822cde1887e42c9475393b1072a2289";
  let creator = "";
  let proposedSolution = this.app.crypto.hash(blk.block.creator + this.solution.random);

  let difficultyOrder = Math.floor(diff);
  let difficultyGrain = diff % 1;


  let th = parseInt(random.slice(0,difficultyOrder+1),16);
  let ph = parseInt(target.slice(0,difficultyOrder+1),16);

  console.log ( th + " vs " + ph );

  if (th >= ph && (th-ph)/16 <= difficultyGrain) {
    console.log("Valid Solution");
    return true;
  } else {
    console.log("Invalid Solution");
    return false;
  }




