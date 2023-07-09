//run with node .\data\build.js
const ALL_CARDS = require('../data/scryfall-oracle-cards.json');
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

//Mapping of scryfall attributes to synonymns and maybe more data.
const namedAttributes = {
    color_identity: {[SAMPLES]:["color identity", "color ID"]},
    colors: {[SAMPLES]:["colors", "color"]},
    cmc: {
        [SAMPLES]:["converted mana cost", "converted mana", "CMC", "mana value"],
        [INTENT_NAME]: "GetCMCIntent"
    },
    edhrec_rank: {[SAMPLES]:["EDH Rec Rank", "EDH recommendation ranking"]},
    legalities: {[SAMPLES]:["legal", "legal sets"]},
    mana_cost: {[SAMPLES]:["mana cost", "cost"], [INTENT_NAME]: "GetManaCostIntent"},
    //rulings_uri
    // rulings: {[SAMPLES]:["rulings", "other rulings", "any rulings"]},
    type_line: {[SAMPLES]:["type line", "type", "card type", "card types"]},
    // subtypes: {[SAMPLES]:["sub-types", "sub types"]},
    // supertypes: {[SAMPLES]:["super types", "super type"]},
    oracle_text: {[SAMPLES]:["text", "rules text", "oracle text"]},
    // type: {[SAMPLES]:["type", "card type"]},
    // types: {[SAMPLES]:["types", "card types"]},
    power: {[SAMPLES]:["power", "strength", "attack"]},
    toughness: {[SAMPLES]:["toughness", "how tough"]},
    name: {[SAMPLES]:["name"]},
    loyalty: {[SAMPLES]:["loyalty"]},
}
// printings: {[SAMPLES]:["printed sets", "printings"]},
//

const BUCKET_NAME = 'mtg-json';
//TODO Remove this.
const ALLOWED_SETS = [
    'MH1','THB',
    'ELD','WAR','RNA','GRN',
    'OGW','SOI','EMN','KLD','AER','AKH','HOU','XLN','RIX','DOM',
    'RTR','GTC','DGM','THS','BND','JOU','KTK','FRF','DTK','BFZ',
    'ARB','ZEN','WWK','ROE','SOM','MBS','NPH','ISD','DKA','AVR',
    'TSB','TSP','PLC','FUT','LRW','MOR','SHM','EVE','ALA','CON',
    'MRD','DST','5DN','CHK','BOK','SOK','RAV','GPT','DIS','CSP',
    'M21','M19','M20','ORI','M15','M14','M13','M12','M11','10E','9ED','8ED'
];
//TODO update icons and svgs and expose through CDN and use in svg icon. 

//Config
const MAX_SIZE_VALUE = 140

function putJson(key, bodyData) {
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
    if(nameSet.has(str)) {
        console.log(`skipping ${str}`);
        return true;
    }
    if(MAX_SIZE_VALUE <= str.length) {
        return true;
    }
    return false;
}

function setAllowed(printings) {
    //todo use legalities instead . Hmm Maybe not. Legalities will allow even more duplicates..
    //TODO use catalog entities instead of all and upload everything https://github.com/alexa/alexa-cookbook/tree/master/feature-demos/skill-demo-catalog-entity
    return intersect([printings], ALLOWED_SETS).length > 0;
}

function intersect(a, b) {
    return [...new Set(a)].filter(x => new Set(b).has(x));
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

//Start executable code.
let nameSet = new Set();

let interactionModelCardsType = {
    name: "Cards",
    values: [
      
    ]
  };

let intentList = [];
let attrSet = new Set();
let setSet = new Set();
let artistList = [];
let ids = [];

let count=0;
ALL_CARDS.forEach(function(elemData) {
    setSet.add(elemData.set.toUpperCase());
    if(shouldSkip(elemData.name) ) {//|| !setAllowed(elemData.set.toUpperCase())
        console.log(`Skipping: ${elemData.name} from ${elemData.set.toUpperCase()}`);
        return;
    }
    nameSet.add(elemData.name);
    interactionModelCardsType.values.push({
        name: {
            value: sanitize(elemData.name)
        },
        id: ids.length//Set index as id to shorten interaction model length
    });
    //Add ID to list to write out for mapping in the skill. Length pre op matches new pushed index.
    ids.push(elemData.id);

    if(elemData.image_uris) {
        artistList.push({
            bannerURL: elemData.image_uris.art_crop,
            artist: elemData.artist
        });
    }
    
    Object.keys(elemData).forEach(function(item) {
        attrSet.add(item);
    });
    count++;

    //write elemData to s3 bucket.
    // putJson(elemData.id + ".json", elemData);
});

putJson("bannerImages.json", artistList);


//Transform the configuration format into intent list
Object.keys(namedAttributes).forEach(function(key) {
    nameAttrObj = namedAttributes[key];
    if(nameAttrObj[INTENT_NAME]) {
        intentList.push({
            [INTENT_NAME]: nameAttrObj[INTENT_NAME],
            [SAMPLES]: nameAttrObj[SAMPLES]
        })
    }
});
console.log("interactionModelCardsType values length",interactionModelCardsType.values.length);
fs.writeFile("./build/types.json", JSON.stringify(interactionModelCardsType), function(err) {
    if(err) {
        return console.log(err);
    }
    console.log("Interaction Model Types File Made! Wrote " + count) + " cards.";
});

fs.writeFile("./build/ids.json", JSON.stringify(ids), function(err) {
    if(err) {
        return console.log(err);
    }
    console.log("Scryfall Ids list File Made! Wrote " + ids.length) + " cards.";
});

fs.writeFile("./build/intents.json", JSON.stringify(intentList), function(err) {
    if(err) {
        return console.log(err);
    }
    console.log("Intents File Made!");
});

fs.writeFile("./build/sets.json", JSON.stringify(Array.from(setSet)), function(err) {
    if(err) {
        return console.log(err);
    }
    console.log("Sets file Made!");
});


