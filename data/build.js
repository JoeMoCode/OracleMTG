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
    return intersect(printings, ALLOWED_SETS).length > 0;
}

function intersect(a, b) {
    return [...new Set(a)].filter(x => new Set(b).has(x));
}

let interactionModelType = {
    name: "Cards",
    values: [
      
    ]
  };

let keyArr = Object.keys(ALL_CARDS);
for (const i in keyArr) {
    //const element = keyArr[i];
    const elemData = ALL_CARDS[keyArr[i]];
    if(shouldSkip(keyArr[i]) || !setAllowed(elemData.printings)) {
        console.log(`Skipping: ${keyArr[i]}`);
        continue;
    }
    interactionModelType.values.push({
        name: {
            value: sanitize(keyArr[i])
        },
        id: elemData.uuid
    });

    //write elemData to s3 bucket.
    // putCard(elemData.uuid + ".json", elemData);
}

fs.writeFile("./data/types.json", JSON.stringify(interactionModelType), function(err) {
    if(err) {
        return console.log(err);
    }
    console.log("Interaction Model Types Made!");
});

