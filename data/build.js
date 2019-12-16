//run with node .\data\build.js
const ALL_CARDS = require('../data/AllCards.json');
const fs = require('fs');
const AWS = require('aws-sdk');
AWS.config.update(
    {
        region: 'us-east-1',
        credentials: new AWS.SharedIniFileCredentials(
            {profile: 'ask_cli_default'}
        )
    }
);
const S3 = new AWS.S3();

const SAMPLES = "samples";
const INTENT_NAME = "name";

//Mapping of mtgjson attributes to synonymns and maybe more data.
const namedAttributes = {
    colorIdentity: {[SAMPLES]:["color identity"]},
    colors: {[SAMPLES]:["colors"]},
    convertedManaCost: {
        [SAMPLES]:["converted mana cost", "converted mana"],
        [INTENT_NAME]: "GetCMCIntent"
    },
    edhrecRank: {[SAMPLES]:["EDH Rec Rank", "EDH recommendation ranking"]},
    // foreignData
    // layout
    legalities: {[SAMPLES]:["legal", "legal sets"]},
    manaCost: {[SAMPLES]:["mana cost"]},
    // mtgoFoilId
    // mtgoId
    // mtgstocksId
    // name
    printings: {[SAMPLES]:["printed sets", "printings"]},
    // purchaseUrls
    rulings: {[SAMPLES]:["rulings", "other rulings", "any rulings"]},
    // scryfallOracleId
    subtypes: {[SAMPLES]:["sub-types", "sub types"]},
    supertypes: {[SAMPLES]:["super types", "super type"]},
    text: {[SAMPLES]:["text", "rules text", "oracle text"]},
    type: {[SAMPLES]:["type", "card type"]},
    types: {[SAMPLES]:["types", "card types"]},
    // uuid
    // mtgArenaId
    power: {[SAMPLES]:["power", "strength"]},
    toughness: {[SAMPLES]:["toughness", "how tough"]},
    // faceConvertedManaCost
    names: {[SAMPLES]:["names"]},
    // side: 
    leadershipSkills: {[SAMPLES]:["leadership skills"]},
    loyalty: {[SAMPLES]:["loyalty"]},
    colorIndicator: {[SAMPLES]:["color indicator"]},
    hasNoDeckLimit: {[SAMPLES]:["deck limit", "has no deck limit"]}
}

const BUCKET_NAME = 'mtg-json';
const S3_KEY = 'AllCards.json';
const ALLOWED_SETS = [
    'MH1',
    'ELD','WAR','RNA','GRN',
    'OGW','SOI','EMN','KLD','AER','AKH','HOU','XLN','RIX','DOM',
    'RTR','GTC','DGM','THS','BND','JOU','KTK','FRF','DTK','BFZ',
    'ARB','ZEN','WWK','ROE','SOM','MBS','NPH','ISD','DKA','AVR',
    'TSB','TSP','PLC','FUT','LRW','MOR','SHM','EVE','ALA','CON',
    'MRD','DST','5DN','CHK','BOK','SOK','RAV','GPT','DIS','CSP',
    'M19','M20','ORI','M15','M14','M13','M12','M11','10E','9ED','8ED'
];
//Config
const MAX_SIZE_VALUE = 140

function putCard(key, bodyData) {
    const params = {
        Bucket: BUCKET_NAME,
        Key: key,
        Body: JSON.stringify(bodyData)
    }

    S3.putObject(params,  function(err, data) {
        if (err) {
            console.log(err, err.stack); // an error occurred
            return;
        }
    });
}

function sanitize(str) {
    //TODO Slot values cannot contain double quotation marks.
    return str.replace(/\"/gi, "");
}

function shouldSkip(str) {
    if(MAX_SIZE_VALUE <= str.length) {
        return true;
    }
    return false;
}

function setAllowed(printings) {
    //todo use legalities instead 
    //TODO use catalog entities instead of all and upload everything https://github.com/alexa/alexa-cookbook/tree/master/feature-demos/skill-demo-catalog-entity
    return intersect(printings, ALLOWED_SETS).length > 0;
}

function intersect(a, b) {
    return [...new Set(a)].filter(x => new Set(b).has(x));
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

//Start executable code.
let interactionModelCardsType = {
    name: "Cards",
    values: [
      
    ]
  };

let intentList = [];
let attrSet = new Set();

let keyArr = Object.keys(ALL_CARDS);
for (const i in keyArr) {
    //const element = keyArr[i];
    const elemData = ALL_CARDS[keyArr[i]];
    if(shouldSkip(keyArr[i]) || !setAllowed(elemData.printings)) {
        console.log(`Skipping: ${keyArr[i]}`);
        continue;
    }
    interactionModelCardsType.values.push({
        name: {
            value: sanitize(keyArr[i])
        },
        id: elemData.uuid
    });
    
    Object.keys(elemData).forEach(function(item) {
        // console.log(item);
        attrSet.add(item);
    });

    //write elemData to s3 bucket.
    // putCard(elemData.uuid + ".json", elemData);
}

//Transform the configuration format into intent list
Object.keys(namedAttributes).forEach(function(key) {
    console.log(JSON.stringify(key));
    nameAttrObj = namedAttributes[key];
    if(nameAttrObj[INTENT_NAME]) {
        intentList.push({
            [INTENT_NAME]: nameAttrObj[INTENT_NAME],
            [SAMPLES]: nameAttrObj[SAMPLES]
        })
    }
});

fs.writeFile("./data/build/types.json", JSON.stringify(interactionModelCardsType), function(err) {
    if(err) {
        return console.log(err);
    }
    console.log("Interaction Model Types Made!");
});

fs.writeFile("./data/build/intents.json", JSON.stringify(intentList), function(err) {
    if(err) {
        return console.log(err);
    }
    console.log("Intents Made!");
});

