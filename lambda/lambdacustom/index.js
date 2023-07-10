const Alexa = require('ask-sdk-core');
const persistenceAdapter = require('ask-sdk-s3-persistence-adapter');
const metricsLogger = require('./metrics.js');

const cardDocument = require('./documents/CardDocument.json');
const cardDocumentText = require('./documents/CardDocumentText.json');
const welcomeDocument = require('./documents/WelcomeDocument.json');
const specialSymbols = require('./data/symbols.json');
const scryfallIds = require("./data/ids.json");
const intentAttrData = require("./data/attributeIntentData.json");

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
const CAPABILITIES_MSG = "You can ask me for the oracle text of any magic card. ";
const PROMPT = "What can I help you with? ";
const DEFAULT_ERROR = "Sorry, I had trouble with that. "
const FALLBACK_MESSAGE = "Hmm sorry I did not understand that. You can ask me for any magic the gathering card or about attributes for a card, such as mana value. What would you like to know about? "

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

const GET_CARD_INTENT = 'GetCardIntent';
const GetCardIntentHandler = {
    canHandle(handlerInput) {
        console.log("In cardIntent canHandle sessions: ", handlerInput.attributesManager.getSessionAttributes());
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === GET_CARD_INTENT;
    },
    async handle(handlerInput) {
        const attributesManager = handlerInput.attributesManager;
        const sessionAttributes = attributesManager.getSessionAttributes() || {};

        let speakOutput = "Hmm, I didn't understand that."
        let responseBuilder = handlerInput.responseBuilder;

        const slotValue = handlerInput.requestEnvelope.request.intent.slots.card.value;
        console.log(slotValue);

        if(slotValue) {
            const slotId = getCardResolutionValue(handlerInput)?.id;
            if(!slotId) {
                return handlerInput.responseBuilder
                    .speak(`Sorry, I failed to find the card, ${slotValue}. ` + PROMPT)
                    .reprompt(PROMPT)
                    .getResponse();
            }
            const slotValueReal = getCardResolutionValue(handlerInput)?.name;
            const cardData = await getCardData(slotId);
            console.log("CardData: ", cardData);
            //Save this card in session memory for later queries
            sessionAttributes[CARD_CONTEXT_KEY] = {
                name: slotValueReal,
                id: slotId
            }

            if(cardData) {
                speakOutput = sanitizeText(`${slotValueReal} is of type ${cardData.type_line}, costs ${cardData.mana_cost}, and has the text, ${cardData.oracle_text} `) + PROMPT;
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

function createGetAttrObj(props) {
    return {
        noContextHandler: {
            canHandle: (handlerInput)=> {
                return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' 
                    && (Alexa.getIntentName(handlerInput.requestEnvelope) === props.intentName)
            },
            handle: (handlerInput) => {
                const attributesManager = handlerInput.attributesManager;
                const sessionAttributes = attributesManager.getSessionAttributes() || {};
                
                sessionAttributes[ATTRIBUTE_ASK_KEY] = props.attrKey;
        
                return handlerInput.responseBuilder
                    .speak(props.askForInfo)
                    .reprompt(props.askForInfo)
                    .getResponse();
            }
        },
        withContextHandler: {
            canHandle: (handlerInput) => {
                const attributesManager = handlerInput.attributesManager;
                const sessionAttributes = attributesManager.getSessionAttributes() || {};
                console.log("canHandle with context: ", sessionAttributes);
                return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' && 
                    (Alexa.getIntentName(handlerInput.requestEnvelope) === GET_CARD_INTENT 
                        && sessionAttributes.hasOwnProperty(ATTRIBUTE_ASK_KEY)
                        && sessionAttributes[ATTRIBUTE_ASK_KEY] == props.attrKey);
            },
            handle: async (handlerInput) => {
                const attributesManager = handlerInput.attributesManager;
                const sessionAttributes = attributesManager.getSessionAttributes() || {};

                if(handlerInput?.requestEnvelope?.request?.intent?.slots?.card?.value) {
                    console.log("writing card to sessionAttrs");
                    const slotId = getCardResolutionValue(handlerInput).id;
                    const slotValueReal = getCardResolutionValue(handlerInput).name;
                    //Save this card in session memory for later queries
                    sessionAttributes[CARD_CONTEXT_KEY] = {
                        name: slotValueReal,
                        id: slotId
                    }
                }
                
                const cardId = sessionAttributes[CARD_CONTEXT_KEY].id;
                const cardName = sessionAttributes[CARD_CONTEXT_KEY].name;
                
                sessionAttributes[ATTRIBUTE_ASK_KEY] = "";

                const cardData = await getCardData(cardId);
                let speakOutput = "Oh, I'm sorry, but I do not know anything about ${cardName}. "
                if(cardData && props.attributeId in cardData) {
                    speakOutput = sanitizeText(`The card ${cardName} has ${props.attributeName} ${cardData[props.attributeId]}. `);
                } else if(cardData) {
                    speakOutput = `Hmm, I'm sorry. I do not know the ${props.attributeName} of ${cardName}. `;
                }

                //Handle APL
                if (cardData && Alexa.getSupportedInterfaces(handlerInput.requestEnvelope)['Alexa.Presentation.APL']) {
                    // Add the RenderDocument directive to the responseBuilder
                    handlerInput.responseBuilder.addDirective({
                        type: 'Alexa.Presentation.APL.RenderDocument',
                        token: CARD_TOKEN,
                        document: cardDocument,
                        datasources: {
                            "card": {
                                "name": `${cardName}`,
                                "manaCost": `${cardData.mana_cost}`,
                                "type": `${cardData.type_line}`,
                                "text": `${cardData.oracle_text}`,
                                "url": `${cardData.image_uris.large}`
                            }
                        }
                    });
                }

                speakOutput += PROMPT;

                return handlerInput.responseBuilder
                        .speak(speakOutput)
                        .reprompt(PROMPT)
                        .getResponse();
            }
        }
    }
}

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

const FallbackHandler = {
    canHandle(handlerInput) {
      return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
        && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.FallbackIntent';
    },
    handle(handlerInput) {
      return handlerInput.responseBuilder
        .speak(FALLBACK_MESSAGE)
        .reprompt(PROMPT)
        .getResponse();
    },
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
    const scryfallId = scryfallIds[cardId];
    console.log("live from scryfall ", scryfallId);
    return scryfall.getCard(scryfallId);
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
function sanitizeText(text) {
    //Map of symbol to english words.
    let sanitizedText = text;
    specialSymbols.data.forEach(symbolDefinition => {
        const symbolRegex = new RegExp(symbolDefinition["symbol"].replace("{","\\{").replace("}","\\}"),"g");
        sanitizedText = sanitizedText.replace(symbolRegex, symbolDefinition["english"] +  " ");
    });
    
    return sanitizedText;
}

const LoadUserDataInterceptor = {
    async process(handlerInput) {
        if(Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest') {
            const attributesManager = handlerInput.attributesManager;
            const persistentAttributes = await attributesManager.getPersistentAttributes() || {};
    
            attributesManager.setSessionAttributes(persistentAttributes);
        }
    }
};

const attributeHandlers = intentAttrData.flatMap((props) => {
    const resultHandlers = createGetAttrObj(props);
    return [//Order matters here.
        resultHandlers.noContextHandler,
        resultHandlers.withContextHandler
    ]
});

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
        ...attributeHandlers,
        GetCardIntentHandler, // Keep this low since it is used by Attribute queries too.
        HelpIntentHandler,
        CancelAndStopIntentHandler,
        SessionEndedRequestHandler,
        FallbackHandler,
        IntentReflectorHandler, // make sure IntentReflectorHandler is last so it doesn't override your custom intent handlers
    )
    .addErrorHandlers(
        ErrorHandler,
    )
    .lambda();
