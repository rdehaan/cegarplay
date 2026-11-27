// Instance data of the loop exercises (tools/exercises.mjs). The optima were computed with Python
// clingo from a one-program encoding; test/exercise.test.mjs checks them with the worked solutions.
export const SEATING = {
  "ring5": {
    "facts": "% Five guests in a ring of rivalries.\nguest(ada,2). guest(bob,1). guest(cy,3). guest(dee,2). guest(eve,2).\nrival(ada,bob). rival(bob,cy). rival(cy,dee). rival(dee,eve). rival(eve,ada).\n",
    "optimum": 1
  },
  "calm6": {
    "facts": "% A ring of six with one more rivalry: two tables are enough for everyone.\nguest(ada,1). guest(bob,1). guest(cy,1). guest(dee,1). guest(eve,1). guest(fay,1).\nrival(ada,bob). rival(bob,cy). rival(cy,dee). rival(dee,eve). rival(eve,fay). rival(fay,ada). rival(ada,dee).\n",
    "optimum": 0
  },
  "petersen": {
    "facts": "% The Petersen graph: ten guests, each with three rivals; every uninvitation costs 1.\nguest(ada,1). guest(bob,1). guest(cy,1). guest(dee,1). guest(eve,1). guest(fay,1). guest(gus,1). guest(hal,1). guest(ivy,1). guest(jo,1).\nrival(ada,bob). rival(bob,cy). rival(cy,dee). rival(dee,eve). rival(eve,ada). rival(fay,hal). rival(gus,ivy). rival(hal,jo). rival(ivy,fay). rival(jo,gus). rival(ada,fay). rival(bob,gus). rival(cy,hal). rival(dee,ivy). rival(eve,jo).\n",
    "optimum": 3
  },
  "party12": {
    "facts": "% 12 guests, 20 random rivalries, costs 1 to 3.\nguest(ada,3). guest(bob,1). guest(cy,3). guest(dee,2). guest(eve,2). guest(fay,1). guest(gus,3). guest(hal,3). guest(ivy,1). guest(jo,3). guest(kit,1). guest(lu,2).\nrival(ada,fay). rival(ada,gus). rival(ada,hal). rival(ada,jo). rival(ada,lu). rival(bob,cy). rival(bob,dee). rival(bob,eve). rival(bob,hal). rival(bob,jo). rival(cy,jo). rival(dee,eve). rival(dee,fay). rival(dee,ivy). rival(dee,kit). rival(eve,hal). rival(gus,kit). rival(gus,lu). rival(hal,lu). rival(ivy,kit).\n",
    "optimum": 5
  },
  "party16": {
    "facts": "% 16 guests, 30 random rivalries, costs 1 to 3.\nguest(ada,3). guest(bob,2). guest(cy,3). guest(dee,3). guest(eve,3). guest(fay,1). guest(gus,3). guest(hal,1). guest(ivy,3). guest(jo,3). guest(kit,1). guest(lu,3). guest(max,2). guest(ned,2). guest(oz,2). guest(pia,3).\nrival(ada,kit). rival(ada,ned). rival(ada,oz). rival(bob,cy). rival(bob,eve). rival(bob,lu). rival(cy,jo). rival(cy,pia). rival(dee,eve). rival(dee,hal). rival(dee,pia). rival(eve,fay). rival(eve,ned). rival(eve,oz). rival(eve,pia). rival(gus,jo). rival(gus,ned). rival(gus,pia). rival(hal,ivy). rival(hal,jo). rival(hal,oz). rival(ivy,kit). rival(ivy,lu). rival(ivy,pia). rival(jo,max). rival(jo,ned). rival(kit,pia). rival(lu,max). rival(max,ned). rival(oz,pia).\n",
    "optimum": 8
  },
  "dense14": {
    "facts": "% 14 guests, 45 random rivalries (a quarrelsome family), costs 1 to 3.\nguest(ada,1). guest(bob,2). guest(cy,2). guest(dee,1). guest(eve,2). guest(fay,2). guest(gus,3). guest(hal,1). guest(ivy,3). guest(jo,1). guest(kit,3). guest(lu,2). guest(max,3). guest(ned,1).\nrival(ada,bob). rival(ada,dee). rival(ada,eve). rival(ada,gus). rival(ada,hal). rival(ada,ivy). rival(ada,jo). rival(ada,kit). rival(ada,max). rival(ada,ned). rival(bob,cy). rival(bob,fay). rival(bob,gus). rival(bob,ivy). rival(bob,jo). rival(bob,kit). rival(bob,lu). rival(bob,max). rival(cy,dee). rival(cy,jo). rival(dee,ivy). rival(dee,jo). rival(dee,max). rival(dee,ned). rival(eve,fay). rival(eve,gus). rival(eve,hal). rival(eve,kit). rival(eve,lu). rival(eve,ned). rival(fay,hal). rival(fay,max). rival(gus,hal). rival(gus,lu). rival(hal,ivy). rival(hal,jo). rival(hal,kit). rival(hal,max). rival(hal,ned). rival(ivy,jo). rival(ivy,max). rival(jo,kit). rival(jo,max). rival(kit,lu). rival(max,ned).\n",
    "optimum": 8
  },
  "dense16": {
    "facts": "% 16 guests, 55 random rivalries (a quarrelsome family), costs 1 to 3.\nguest(ada,2). guest(bob,3). guest(cy,3). guest(dee,3). guest(eve,2). guest(fay,3). guest(gus,2). guest(hal,2). guest(ivy,3). guest(jo,1). guest(kit,2). guest(lu,1). guest(max,3). guest(ned,2). guest(oz,1). guest(pia,2).\nrival(ada,cy). rival(ada,dee). rival(ada,eve). rival(ada,fay). rival(ada,gus). rival(ada,ivy). rival(ada,kit). rival(ada,max). rival(ada,ned). rival(bob,dee). rival(bob,gus). rival(bob,hal). rival(bob,ivy). rival(bob,jo). rival(bob,ned). rival(cy,dee). rival(cy,gus). rival(cy,hal). rival(cy,kit). rival(cy,lu). rival(cy,ned). rival(dee,ivy). rival(dee,kit). rival(dee,max). rival(dee,pia). rival(eve,hal). rival(eve,ned). rival(eve,pia). rival(fay,gus). rival(fay,hal). rival(fay,ivy). rival(fay,kit). rival(fay,lu). rival(fay,oz). rival(fay,pia). rival(gus,max). rival(hal,ivy). rival(hal,jo). rival(hal,lu). rival(hal,max). rival(hal,ned). rival(hal,oz). rival(hal,pia). rival(ivy,kit). rival(ivy,lu). rival(ivy,max). rival(kit,max). rival(kit,ned). rival(kit,oz). rival(kit,pia). rival(lu,ned). rival(lu,oz). rival(lu,pia). rival(max,ned). rival(max,pia).\n",
    "optimum": 10
  },
  "dense18": {
    "facts": "% 18 guests, 60 random rivalries (a quarrelsome family), costs 1 to 3.\nguest(ada,1). guest(bob,3). guest(cy,3). guest(dee,2). guest(eve,1). guest(fay,2). guest(gus,3). guest(hal,2). guest(ivy,1). guest(jo,2). guest(kit,1). guest(lu,1). guest(max,2). guest(ned,1). guest(oz,3). guest(pia,2). guest(quin,2). guest(rex,2).\nrival(ada,bob). rival(ada,eve). rival(ada,ivy). rival(ada,jo). rival(ada,kit). rival(ada,ned). rival(bob,eve). rival(bob,gus). rival(bob,hal). rival(bob,kit). rival(bob,lu). rival(bob,max). rival(bob,rex). rival(cy,eve). rival(cy,gus). rival(cy,ivy). rival(cy,ned). rival(cy,quin). rival(cy,rex). rival(dee,fay). rival(dee,jo). rival(dee,kit). rival(eve,fay). rival(eve,hal). rival(eve,ivy). rival(eve,kit). rival(eve,lu). rival(eve,max). rival(eve,ned). rival(eve,oz). rival(eve,pia). rival(eve,quin). rival(fay,hal). rival(fay,kit). rival(fay,ned). rival(fay,quin). rival(fay,rex). rival(gus,hal). rival(gus,jo). rival(gus,lu). rival(gus,ned). rival(hal,jo). rival(hal,lu). rival(hal,pia). rival(ivy,jo). rival(ivy,lu). rival(ivy,ned). rival(ivy,oz). rival(ivy,rex). rival(jo,ned). rival(jo,quin). rival(kit,oz). rival(lu,ned). rival(lu,oz). rival(max,oz). rival(max,rex). rival(ned,rex). rival(oz,pia). rival(oz,rex). rival(pia,quin).\n",
    "optimum": 11
  },
  "tables19": {
    "facts": "% 19 guests in 5 separate odd rings of rivalries (sizes 3, 5, 3, 5, 3), plus 3 rivalries between rings; costs 1 to 3.\nguest(ada,1). guest(bob,2). guest(cy,2). guest(dee,1). guest(eve,1). guest(fay,3). guest(gus,1). guest(hal,1). guest(ivy,1). guest(jo,1). guest(kit,3). guest(lu,1). guest(max,2). guest(ned,3). guest(oz,1). guest(pia,2). guest(quin,2). guest(rex,2). guest(sam,2).\nrival(ada,bob). rival(ada,cy). rival(bob,cy). rival(cy,eve). rival(dee,eve). rival(dee,hal). rival(dee,ivy). rival(eve,fay). rival(fay,gus). rival(gus,hal). rival(ivy,jo). rival(ivy,kit). rival(jo,kit). rival(lu,max). rival(lu,pia). rival(max,ned). rival(max,pia). rival(ned,oz). rival(oz,pia). rival(quin,rex). rival(quin,sam). rival(rex,sam).\n",
    "optimum": 6
  },
  "tables24": {
    "facts": "% 24 guests in 6 separate odd rings of rivalries (sizes 5, 3, 5, 3, 5, 3), plus 4 rivalries between rings; costs 1 to 3.\nguest(ada,2). guest(bob,3). guest(cy,2). guest(dee,2). guest(eve,1). guest(fay,1). guest(gus,3). guest(hal,1). guest(ivy,2). guest(jo,3). guest(kit,2). guest(lu,3). guest(max,1). guest(ned,2). guest(oz,3). guest(pia,3). guest(quin,3). guest(rex,1). guest(sam,3). guest(tom,2). guest(uma,1). guest(vic,3). guest(wes,2). guest(xia,3).\nrival(ada,bob). rival(ada,eve). rival(bob,cy). rival(cy,dee). rival(cy,lu). rival(dee,eve). rival(fay,gus). rival(fay,hal). rival(fay,xia). rival(gus,hal). rival(ivy,jo). rival(ivy,max). rival(ivy,tom). rival(jo,kit). rival(jo,vic). rival(kit,lu). rival(lu,max). rival(ned,oz). rival(ned,pia). rival(oz,pia). rival(quin,rex). rival(quin,uma). rival(rex,sam). rival(sam,tom). rival(tom,uma). rival(vic,wes). rival(vic,xia). rival(wes,xia).\n",
    "optimum": 8
  },
  "tables23": {
    "facts": "% 23 guests in 5 separate odd rings of rivalries (sizes 3, 3, 5, 5, 7), plus 4 rivalries between rings; costs 1 to 3.\nguest(ada,3). guest(bob,1). guest(cy,2). guest(dee,2). guest(eve,3). guest(fay,1). guest(gus,1). guest(hal,2). guest(ivy,2). guest(jo,2). guest(kit,3). guest(lu,1). guest(max,1). guest(ned,3). guest(oz,2). guest(pia,2). guest(quin,1). guest(rex,1). guest(sam,3). guest(tom,2). guest(uma,1). guest(vic,2). guest(wes,1).\nrival(ada,bob). rival(ada,cy). rival(bob,cy). rival(dee,eve). rival(dee,fay). rival(eve,fay). rival(eve,rex). rival(gus,hal). rival(gus,kit). rival(hal,ivy). rival(hal,sam). rival(ivy,jo). rival(jo,kit). rival(lu,max). rival(lu,pia). rival(lu,tom). rival(max,ned). rival(ned,oz). rival(oz,pia). rival(pia,uma). rival(quin,rex). rival(quin,wes). rival(rex,sam). rival(sam,tom). rival(tom,uma). rival(uma,vic). rival(vic,wes).\n",
    "optimum": 5
  }
};
export const VOTING = [
  {
    "id": "dictator3",
    "facts": "% Player 1 decides alone.\nplayer(1..3).\nwins(S) :- coalition(S), in(1,S).\n",
    "constants": {
      "n": "3",
      "wmax": "2"
    },
    "expected": {
      "optimum": 1
    }
  },
  {
    "id": "unanimity3",
    "facts": "% Everyone must agree.\nplayer(1..3).\nwins(S) :- coalition(S), #count { P : in(P,S) } = 3.\n",
    "constants": {
      "n": "3",
      "wmax": "2"
    },
    "expected": {
      "optimum": 3
    }
  },
  {
    "id": "majority5",
    "facts": "% Simple majority of five.\nplayer(1..5).\nwins(S) :- coalition(S), #count { P : in(P,S) } >= 3.\n",
    "constants": {
      "n": "5",
      "wmax": "6"
    },
    "expected": {
      "optimum": 5
    }
  },
  {
    "id": "chair4",
    "facts": "% the chair (1) and at least two others, or all three others\nplayer(1..4).\nwins(S) :- coalition(S), in(1,S), #count { P : in(P,S), P > 1 } >= 2.\nwins(S) :- coalition(S), in(2,S), in(3,S), in(4,S).\n",
    "constants": {
      "n": "4",
      "wmax": "6"
    },
    "expected": {
      "optimum": 4
    }
  },
  {
    "id": "vetoes5",
    "facts": "% players 1 and 2 have a veto; they need at least two of 3, 4, 5\nplayer(1..5).\nwins(S) :- coalition(S), in(1,S), in(2,S), #count { P : in(P,S), P > 2 } >= 2.\n",
    "constants": {
      "n": "5",
      "wmax": "6"
    },
    "expected": {
      "optimum": 7
    }
  },
  {
    "id": "two-pairs",
    "facts": "% (1 and 2) or (3 and 4): not a weighted game\nplayer(1..4).\nwins(S) :- coalition(S), in(1,S), in(2,S).\nwins(S) :- coalition(S), in(3,S), in(4,S).\n",
    "constants": {
      "n": "4",
      "wmax": "6"
    },
    "expected": {
      "solutions": 0
    }
  },
  {
    "id": "council6",
    "facts": "% 1 alone with any two others, or 2 and 3 with any two of 4, 5, 6, or everyone but 1\nplayer(1..6).\nwins(S) :- coalition(S), in(1,S), #count { P : in(P,S), P > 1 } >= 2.\nwins(S) :- coalition(S), in(2,S), in(3,S), #count { P : in(P,S), P > 3 } >= 2.\nwins(S) :- coalition(S), #count { P : in(P,S), P > 1 } >= 5.\n",
    "constants": {
      "n": "6",
      "wmax": "6"
    },
    "expected": {
      "optimum": 18
    }
  },
  {
    "id": "steps6",
    "facts": "% 1 counts thrice, 2 and 3 twice, the rest once; quota 6\nplayer(1..6).\nwins(S) :- coalition(S), #sum { 3,P : in(P,S), P = 1; 2,P : in(P,S), P = 2..3; 1,P : in(P,S), P > 3 } >= 6.\n",
    "constants": {
      "n": "6",
      "wmax": "6"
    },
    "expected": {
      "optimum": 10
    }
  }
];
