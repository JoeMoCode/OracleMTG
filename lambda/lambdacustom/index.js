const Alexa = require('ask-sdk-core');
const persistenceAdapter = require('ask-sdk-s3-persistence-adapter');
const metricsLogger = require('./metrics.js');

const cardDocument = require('./documents/CardDocument.json');
const cardDocumentText = require('./documents/CardDocumentText.json');
const welcomeDocument = require('./documents/WelcomeDocument.json');
const specialSymbols = require('./symbols.json').data;

//Nice page https://scryfall.com/docs/api/bulk-data

const AWS = require('aws-sdk');
AWS.config.update(
    {
        region: 'us-east-1'
    }
);
const S3 = new AWS.S3();
const scryfall = require("scryfall");

const BUCKET_NAME = 'mtg-json';
const FILE_NAME_RANDOM_BANNERS = "bannerImages.json"; // structure: [{bannerURL:"",artist:"John Smith"}...]
const CARD_TOKEN = "cardDocumentId";
const CARD_CONTEXT_KEY = "currentCard";
const USER_DATA_KEY = "userData";
const ATTRIBUTE_ASK_KEY = "cardAttr";
const PERSISTENCE_BUCKET = "mtg-skill-persistence";

//Attr types
const CONVERTED_MANA = "cmc";

//Strings. TODO Localize
const WELCOME_MSG = "Welcome to Magic Oracle. The unofficial Alexa MTG Oracle Skill. ";
const WELCOME_BACK_MSG = "Welcome back to Magic Oracle. ";
const CMC_ASK_CARD = "Which card do you want the converted mana cost of? ";
const CAPABILITIES_MSG = "You can ask me for the oracle text of any magic card. ";
const PROMPT = "What can I help you with? ";
const DEFAULT_ERROR = "Sorry, I had trouble with that. "
const WHAT_DO_PROMPT = "What do you want to do? ";
const ATTRIBUTE_NO_CONTEXT_RESPONSE = "I'm sorry, you will need to ask for the card name and the attribute you want to know about. For instance, you can ask for the converted mana cost of lightning bolt. ";

const LaunchRequestFirstTimeHandler = {
    canHandle(handlerInput) {
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        const isFirstTime = !sessionAttributes.hasOwnProperty(USER_DATA_KEY);
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest' && isFirstTime;
    },
    async handle(handlerInput) {
        //Save the user obj so we know when they return back
        const attributesManager = handlerInput.attributesManager;
        const sessionAttributes = attributesManager.getSessionAttributes() || {};
        sessionAttributes[USER_DATA_KEY] = 1;
        attributesManager.setPersistentAttributes(sessionAttributes);
        attributesManager.savePersistentAttributes();

        const speakOutput = WELCOME_MSG + CAPABILITIES_MSG + PROMPT;

        // await handleWelcomeVisuals(handlerInput);

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(PROMPT)
            .getResponse();
    }
}


const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
    async handle(handlerInput) {
        const speakOutput = WELCOME_BACK_MSG + PROMPT;

        // await handleWelcomeVisuals(handlerInput);

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(PROMPT)
            .getResponse();
    }
};

//TODO Generate these and more intent handlers and refactor to new file.
const GetCMCIntentHandlerNoContext = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' && 
            (Alexa.getIntentName(handlerInput.requestEnvelope) === 'GetCMCIntent');
    },
    handle(handlerInput) {
        const attributesManager = handlerInput.attributesManager;
        const sessionAttributes = attributesManager.getSessionAttributes() || {};
        
        sessionAttributes[ATTRIBUTE_ASK_KEY] = CONVERTED_MANA;

        return handlerInput.responseBuilder
            .speak(CMC_ASK_CARD)
            .reprompt(CMC_ASK_CARD)
            .getResponse();
    }
}

const GetCMCIntentHandler = { // Do add visuals.
    canHandle(handlerInput) {
        const attributesManager = handlerInput.attributesManager;
        const sessionAttributes = attributesManager.getSessionAttributes() || {};

        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' && 
            (Alexa.getIntentName(handlerInput.requestEnvelope) === 'GetCardIntent' && ATTRIBUTE_ASK_KEY in sessionAttributes
                && sessionAttributes[ATTRIBUTE_ASK_KEY] === CONVERTED_MANA);
    },
    handle(handlerInput) {
        const attributeId = "cmc";
        const attribute = "converted mana cost";

        const attributesManager = handlerInput.attributesManager;
        const sessionAttributes = attributesManager.getSessionAttributes() || {};

        //Save this card in session memory for later queries
        sessionAttributes[CARD_CONTEXT_KEY] = {
            name: slotValueReal,
            id: slotId
        }
        
        const cardId = sessionAttributes[CARD_CONTEXT_KEY].id;
        const cardName = sessionAttributes[CARD_CONTEXT_KEY].name;

        return handleGetAttribute(handlerInput, cardName, cardId, attribute, attributeId);
    }
}

const GetCMCWithContextIntentHandler = {
    canHandle(handlerInput) {
        const attributesManager = handlerInput.attributesManager;
        const sessionAttributes = attributesManager.getSessionAttributes() || {};

        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' && 
            (Alexa.getIntentName(handlerInput.requestEnvelope) === 'GetCMCIntent' && CARD_CONTEXT_KEY in sessionAttributes);
    },
    handle(handlerInput) {
        const attributesManager = handlerInput.attributesManager;
        const sessionAttributes = attributesManager.getSessionAttributes() || {};
        
        const cardId = sessionAttributes[CARD_CONTEXT_KEY].id;
        const cardName = sessionAttributes[CARD_CONTEXT_KEY].name;

        const attributeId = "cmc";
        const attribute = "converted mana cost";

        return handleGetAttribute(handlerInput, cardName, cardId, attribute, attributeId);
    }
}

async function handleGetAttribute(handlerInput, cardName, cardId, attribute, attributeId) {
    const cardData = await getCardData(cardId);
    let speakOutput = "Oh, I'm sorry, but I do not know anything about ${cardName}. "
    if(cardData && attributeId in cardData) {
        speakOutput = `The card ${cardName} has ${attribute} ${cardData[attributeId]}. `;
    } else if(cardData) {
        speakOutput = `Hmm, I'm sorry. I do not know the ${attribute} of ${cardName}. `;
    }

    speakOutput += PROMPT;

    return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(PROMPT)
            .getResponse(); 
}

const GetCardIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'GetCardIntent';
    },
    async handle(handlerInput) {
        const attributesManager = handlerInput.attributesManager;
        const sessionAttributes = attributesManager.getSessionAttributes() || {};

        let speakOutput = "Hmm, I didn't understand that."
        let responseBuilder = handlerInput.responseBuilder;

        const slotValue = handlerInput.requestEnvelope.request.intent.slots.card.value;

        console.log(slotValue);

        if(slotValue) {
            const slotId = getCardResolutionValue(handlerInput).id;
            const slotValueReal = getCardResolutionValue(handlerInput).name;
            const cardData = await getCardData(slotId);
            console.log(slotId);

            //Save this card in session memory for later queries
            sessionAttributes[CARD_CONTEXT_KEY] = {
                name: slotValueReal,
                id: slotId
            }

            if(cardData) {
                console.log(JSON.stringify(cardData));
                speakOutput = `${slotValueReal} is of type ${cardData.type_line}, costs ${sanitizeMana(cardData.mana_cost)}, and has the text, ${sanitizeMana(cardData.oracle_text)} ` + PROMPT;
            } else {
                speakOutput = `Oh no, I failed to get the card, ${slotValueReal}. with Id ${slotId}. ` + PROMPT;
            }

            //Handle APL
            if (Alexa.getSupportedInterfaces(handlerInput.requestEnvelope)['Alexa.Presentation.APL']) {
                // Add the RenderDocument directive to the responseBuilder
                responseBuilder.addDirective({
                    type: 'Alexa.Presentation.APL.RenderDocument',
                    token: CARD_TOKEN,
                    document: cardDocument,
                    datasources: {
                        "card": {
                            "name": `${slotValueReal}`,
                            "manaCost": `${cardData.mana_cost}`,
                            "type": `${cardData.type_line}`,
                            "text": `${cardData.oracle_text}`,
                            "url": `${cardData.image_uris.large}`
                        }
                    }
                });
            }
        } else {
            metricsLogger.log();
        }

        return responseBuilder
            .speak(speakOutput)
            .reprompt(PROMPT)
            .getResponse();
    }
};

function getCardResolutionValue(handlerInput) {
    if(handlerInput.requestEnvelope.request.intent.slots.card.resolutions.resolutionsPerAuthority[0].status.code === "ER_SUCCESS_MATCH") {
        return handlerInput.requestEnvelope.request.intent.slots.card.resolutions.resolutionsPerAuthority[0].values[0].value;
    } else {
        return null;
    }
}

const HelpIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
        const speakOutput = CAPABILITIES_MSG + PROMPT;

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(PROMPT)
            .getResponse();
    }
};
const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent'
                || (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'));
    },
    handle(handlerInput) {
        const speakOutput = 'Goodbye!';
        return handlerInput.responseBuilder
            .speak(speakOutput)
            .getResponse();
    }
};
const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
    },
    handle(handlerInput) {
        // Any cleanup logic goes here.
        return handlerInput.responseBuilder.getResponse();
    }
};

// The intent reflector is used for interaction model testing and debugging.
// It will simply repeat the intent the user said. You can create custom handlers
// for your intents by defining them above, then also adding them to the request
// handler chain below.
const IntentReflectorHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest';
    },
    handle(handlerInput) {
        const intentName = Alexa.getIntentName(handlerInput.requestEnvelope);
        const speakOutput = `You just triggered ${intentName}`;

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .getResponse();
    }
};

// Generic error handling to capture any syntax or routing errors. If you receive an error
// stating the request handler chain is not found, you have not implemented a handler for
// the intent being invoked or included it in the skill builder below.
const ErrorHandler = {
    canHandle() {
        return true;
    },
    handle(handlerInput, error) {
        console.log(`~~~~ Error handled: ${error.stack}`);
        const speakOutput = DEFAULT_ERROR + PROMPT;

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

/**
 * Adds welcome visuals to the response for launch request. APL and APLT
 * @param {*} handlerInput 
 */
async function handleWelcomeVisuals(handlerInput) {
    if (Alexa.getSupportedInterfaces(handlerInput.requestEnvelope)['Alexa.Presentation.APLT']) {
        handlerInput.responseBuilder.addDirective({
            type: 'Alexa.Presentation.APLT.RenderDocument',
            token: CARD_TOKEN,
            document: cardDocumentText,
            datasources: {
                "card": {
                    "name": `HI`
                }
            }
        });
    } else if (Alexa.getSupportedInterfaces(handlerInput.requestEnvelope)['Alexa.Presentation.APL']) {
        const randomImageData = await getRandomBannerPicture();
        handlerInput.responseBuilder.addDirective({
            type: 'Alexa.Presentation.APL.RenderDocument',
            token: CARD_TOKEN,
            document: welcomeDocument,
            datasources: {
                "imageUrl": `${randomImageData.bannerURL}`,
                "artist": `Artist: ${randomImageData.artist}`
            }
        });
    }
}

//TODO Use S3 Select instead. This call can be slow
async function getRandomBannerPicture() {
    const allBanners = await getObjectAtKey(FILE_NAME_RANDOM_BANNERS);
    const selection = Math.floor(Math.random() * allBanners.length);
    return allBanners[selection];
}

async function getCardData(cardId) {
    return scryfall.getCard(cardId);
    // const key = cardId + ".json";
    // return getObjectAtKey(key);
}

function getObjectAtKey(key) {
    const params = {
        Bucket: BUCKET_NAME,
        Key: key
    };
    return new Promise((resolve, reject) => {
        S3.getObject(params,  function(err, data) {
            if (err) {
                console.log(err, err.stack); // an error occurred
                reject(err);
            }

            const objectData = data.Body.toString();
            resolve(JSON.parse(objectData));
        });
    });
}
/**
 * like:
 * {
            "object": "card_symbol",
            "symbol": "{T}",
            "svg_uri": "https://svgs.scryfall.io/card-symbols/T.svg",
            "loose_variant": null,
            "english": "tap this permanent",
            "transposable": false,
            "represents_mana": false,
            "appears_in_mana_costs": false,
            "mana_value": 0.0,
            "cmc": 0.0,
            "funny": false,
            "colors":
            [],
            "gatherer_alternates":
            [
                "ocT",
                "oT"
            ]
        }
 */
function sanitizeMana(manaCost) {
    //Map of symbol to english words.
    const SANITIZATION_MAP = specialSymbols.forEach(symbolDefinition => {
            return {[symbolDefinition[symbol]]: symbolDefinition[english]}
        });

    let sanitizedManaCost = manaCost;
    Object.keys(SANITIZATION_MAP).forEach(element => {
        const regex = new RegExp(element,"g");
        sanitizedManaCost = sanitizedManaCost.replace(regex, SANITIZATION_MAP[element]);
    });

    return sanitizedManaCost;
}

const LoadUserDataInterceptor = {
    async process(handlerInput) {
        // console.log(JSON.stringify(handlerInput.requestEnvelope));
        const attributesManager = handlerInput.attributesManager;
        const persistentAttributes = await attributesManager.getPersistentAttributes() || {};
        
        attributesManager.setSessionAttributes(persistentAttributes);
    }
};

// The SkillBuilder acts as the entry point for your skill, routing all request and response
// payloads to the handlers above. Make sure any new handlers or interceptors you've
// defined are included below. The order matters - they're processed top to bottom.
exports.handler = Alexa.SkillBuilders.custom()
    .withPersistenceAdapter(
        new persistenceAdapter.S3PersistenceAdapter({bucketName:PERSISTENCE_BUCKET})
    ).addRequestInterceptors(
        LoadUserDataInterceptor
    )
    .addRequestHandlers(
        LaunchRequestFirstTimeHandler,
        LaunchRequestHandler,
        GetCMCWithContextIntentHandler,
        GetCMCIntentHandler,
        GetCMCIntentHandlerNoContext,//Default handler
        GetCardIntentHandler, // Keep this low since it is used by Attribute queries too.
        HelpIntentHandler,
        CancelAndStopIntentHandler,
        SessionEndedRequestHandler,
        IntentReflectorHandler, // make sure IntentReflectorHandler is last so it doesn't override your custom intent handlers
    )
    .addErrorHandlers(
        ErrorHandler,
        )
    .lambda();
