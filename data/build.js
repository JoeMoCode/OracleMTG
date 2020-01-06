//run with node .\data\build.js
const ALL_CARDS = require('../data/scryfall-default-cards.json');
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
//TODO FIX THESE AND MIGRATE TO CONFIG>
const namedAttributes = {
    colorIdentity: {[SAMPLES]:["color identity"]},
    colors: {[SAMPLES]:["colors"]},
    cmc: {
        [SAMPLES]:["converted mana cost", "converted mana", "CMC"],
        [INTENT_NAME]: "GetCMCIntent"
    },
    edhrecRank: {[SAMPLES]:["EDH Rec Rank", "EDH recommendation ranking"]},
    // foreignData
    // layout
    legalities: {[SAMPLES]:["legal", "legal sets"]},
    mana_cost: {[SAMPLES]:["mana cost"], [INTENT_NAME]: "GetManaCostIntent"},
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
let interactionModelCardsType = {
    name: "Cards",
    values: [
      
    ]
  };

let intentList = [];
let attrSet = new Set();
let setSet = new Set();
let artistList = [];

let count=0;
ALL_CARDS.forEach(function(elemData) {
    setSet.add(elemData.set.toUpperCase());
    if(shouldSkip(elemData.name) || !setAllowed(elemData.set.toUpperCase())) {
        console.log(`Skipping: ${elemData.name} from ${elemData.set.toUpperCase()}`);
        return;
    }
    interactionModelCardsType.values.push({
        name: {
            value: sanitize(elemData.name)
        },
        id: elemData.id
    });

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

fs.writeFile("./data/build/types.json", JSON.stringify(interactionModelCardsType), function(err) {
    if(err) {
        return console.log(err);
    }
    console.log("Interaction Model Types File Made! Uploaded " + count) + " cards.";
});

fs.writeFile("./data/build/intents.json", JSON.stringify(intentList), function(err) {
    if(err) {
        return console.log(err);
    }
    console.log("Intents File Made!");
});

fs.writeFile("./data/build/sets.json", JSON.stringify(Array.from(setSet)), function(err) {
    if(err) {
        return console.log(err);
    }
    console.log("Sets file Made!");
});


