// This sample demonstrates handling intents from an Alexa skill using the Alexa Skills Kit SDK (v2).
// Please visit https://alexa.design/cookbook for additional examples on implementing slots, dialog management,
// session persistence, api calls, and more.
const Alexa = require('ask-sdk-core');
const persistenceAdapter = require('ask-sdk-s3-persistence-adapter');
const cardDocument = require('./documents/CardDocument.json');
const cardDocumentText = require('./documents/CardDocumentText.json');

//callcards from https://www.mtgjson.com/json/AllCards.json TODO set up pipeline
//Nice page https://mtgjson.com/downloads/compiled/

const AWS = require('aws-sdk');
AWS.config.update(
    {
        region: 'us-east-1'
    }
);
const S3 = new AWS.S3();

const BUCKET_NAME = 'mtg-json';
const CARD_TOKEN = "cardDocumentId";
const CARD_CONTEXT_KEY = "currentCard";

//Strings. TODO Localize
const WELCOME_MSG = "Welcome to MTG Oracle. The unofficial Alexa Oracle Skill. ";
const CAPABILITIES_MSG = "You can ask me for the oracle text of any magic card. ";
const PROMPT = "What can I help you with? ";
const WHAT_DO_PROMPT = "What do you want to do? ";
const ATTRIBUTE_NO_CONTEXT_RESPONSE = "I'm sorry, you will need to ask for the card name and the attribute you want to know about. For instance, you can ask for the converted mana cost of lightning bolt. ";

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
    handle(handlerInput) {
        const speakOutput = WELCOME_MSG + CAPABILITIES_MSG + PROMPT;

        if (Alexa.getSupportedInterfaces(handlerInput.requestEnvelope)['Alexa.Presentation.APLT']){
            handlerInput.responseBuilder.addDirective({
                type: 'Alexa.Presentation.APLT.RenderDocument',
                token: CARD_TOKEN,
                document: cardDocumentText,
                datasources: {
                    "card": {
                        "name": `WELCOME`
                    }
                }
            });
        }

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(PROMPT)
            .getResponse();
    }
};

const GetAttributeWithSlotIntentHandler = {
    canHandle(handlerInput) {
        const slotId = getAttributeResolutionValue(handlerInput).id;

        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' && 
            (Alexa.getIntentName(handlerInput.requestEnvelope) === 'GetAttributeIntent' && slotId);
    },
    handle(handlerInput) {
        const attributeId = getAttributeResolutionValue(handlerInput).id;
        const attribute = getAttributeResolutionValue(handlerInput).name;

        return handleGetAttribute(handlerInput, cardId, attribute, attributeId)
    }
}

const GetAttributeWithContextIntentHandler = {
    canHandle(handlerInput) {
        const attributesManager = handlerInput.attributesManager;
        const sessionAttributes = attributesManager.getSessionAttributes() || {};

        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' && 
            (Alexa.getIntentName(handlerInput.requestEnvelope) === 'GetAttributeIntent' && CARD_CONTEXT_KEY in sessionAttributes);
    },
    handle(handlerInput) {
        const attributesManager = handlerInput.attributesManager;
        const sessionAttributes = attributesManager.getSessionAttributes() || {};
        
        const cardId = sessionAttributes[CARD_CONTEXT_KEY].id;
        const cardName = sessionAttributes[CARD_CONTEXT_KEY].name;
        const attributeId = getAttributeResolutionValue(handlerInput).id;
        const attribute = getAttributeResolutionValue(handlerInput).name;

        return handleGetAttribute(handlerInput, cardName, cardId, attribute, attributeId);
    }
}

const GetAttributeDefaultIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' && 
            (Alexa.getIntentName(handlerInput.requestEnvelope) === 'GetAttributeIntent');
    },
    handle(handlerInput) {
        const speakOutput = ATTRIBUTE_NO_CONTEXT_RESPONSE + WHAT_DO_PROMPT;

        return responseBuilder
            .speak(speakOutput)
            .reprompt(WHAT_DO_PROMPT)
            .getResponse();
    }
}

async function handleGetAttribute(handlerInput, cardName, cardId, attribute, attributeId) {
    const cardData = await getCardData(cardId);
    let speakOutput = "Oh, I'm sorry, but I do not know about ${cardName}. "
    if(cardData && attributeId in cardData) {
        speakOutput = `The card ${cardName} has ${attribute} ${cardData.attributeId}. `;
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
                speakOutput = `${slotValueReal} is of type ${cardData.type}, costs ${cardData.manaCost}, and has the text, ${cardData.text}. ` + PROMPT;
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
                            "manaCost": `${cardData.manaCost}`,
                            "type": `${cardData.type}`,
                            "text": `${cardData.text}`,
                            "url": "https://img.scryfall.com/cards/png/front/c/1/c14cdc38-dd46-495e-93bd-d2694b64d5ad.png"//TODO this needs to come from datasource
                        }
                    }
                });
            }
        }

        return responseBuilder
            .speak(speakOutput)
            .reprompt(PROMPT)
            .getResponse();
    }
};

function getCardResolutionValue(handlerInput) {
    return handlerInput.requestEnvelope.request.intent.slots.card.resolutions.resolutionsPerAuthority[0].values[0].value;
}

function getAttributeResolutionValue(handlerInput) {
    return handlerInput.requestEnvelope.request.intent.slots.attribute.resolutions.resolutionsPerAuthority[0].values[0].value;
}

const HelpIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
        const speakOutput = 'You can ask me for the data about a card. I can help you to purchase cards, too! Say the name of a card to get started.';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};
const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'
                || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent');
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
            //.reprompt('add a reprompt if you want to keep the session open for the user to respond')
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
        const speakOutput = `Sorry, I had trouble doing what you asked. Please try again.`;

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

function getCardData(cardId) {
    const key = cardId + ".json";
    console.log("key: "+ key);
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
            console.log(objectData);
            resolve(JSON.parse(objectData));
        });
    });
}


const LoadUserDataInterceptor = {
    async process(handlerInput) {
        console.log(JSON.stringify(handlerInput.requestEnvelope));
        /*const attributesManager = handlerInput.attributesManager;
        const sessionAttributes = await attributesManager.getPersistentAttributes() || {};
        
        const userData = sessionAttributes.hasOwnProperty('userData') ? sessionAttributes.cards : {};
        
        if (userData) {
            attributesManager.setSessionAttributes(sessionAttributes);
        } */
    }
};

// The SkillBuilder acts as the entry point for your skill, routing all request and response
// payloads to the handlers above. Make sure any new handlers or interceptors you've
// defined are included below. The order matters - they're processed top to bottom.
exports.handler = Alexa.SkillBuilders.custom()
    .withPersistenceAdapter(
        new persistenceAdapter.S3PersistenceAdapter({bucketName:process.env.S3_PERSISTENCE_BUCKET})
    ).addRequestInterceptors(
        LoadUserDataInterceptor
    )
    .addRequestHandlers(
        LaunchRequestHandler,
        GetCardIntentHandler,
        GetAttributeWithSlotIntentHandler,
        GetAttributeWithContextIntentHandler,
        GetAttributeDefaultIntentHandler,
        HelpIntentHandler,
        CancelAndStopIntentHandler,
        SessionEndedRequestHandler,
        IntentReflectorHandler, // make sure IntentReflectorHandler is last so it doesn't override your custom intent handlers
        ) 
    .addErrorHandlers(
        ErrorHandler,
        )
    .lambda();
