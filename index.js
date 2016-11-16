var Challenge = require('ledgerloops-challenge');

// in-neighbor        in-peer       out-peer  out-neighbor
//[WE REJECT:]
//      -> cond-prom ->
//      <- reject  <-
//
//[WE REJECT ON REQUEST:]
//      -> cond-prom ->
//                     (wait)
//      -> pls-rej ->
//      <- reject  <-
//
//[OUT-NEIGHBOR REJECTS (ON REQUEST):]
//      -> cond-prom ->
//                     (wait)
//                         -> challenge ->
//                                        -> cond-prom ->
//
// [     -> pls-rej ->                                      ]
// [                        -> pls-rej   ->                 ]
// [                                       -> pls-rej ->    ]
//
//                                        <- reject <-
//                          <- reject <-
//      <- reject  <-
//
//[REJECTION REQUEST TOO LATE OR NONE:]
//      -> cond-prom ->
//                     (wait)
//                         -> challenge ->
//                                        -> cond-prom ->
//
// [     -> pls-rej ->                                      ]
// [                        -> pls-rej   ->                 ]
// [                                       -> pls-rej ->    ]
//
//                                        <- satis-con <-
//                         <- solution <-
//       <- satis-con <-


function Peer(nick, sendToExternal, sendToRouting, updateNeighborStatus) {
  this._peerNick = nick;
  this._sendToExternal = sendToExternal;
  this._sendToRouting = sendToRouting;
  this._updateNeighborStatus = updateNeighborStatus;
  this._ledger = []; // list of transactions
  this._conditionalPromises = {
    rcvd: {}, // received a conditional promise, key is transactionId
    sent: {}, // sent a conditional promise, key is transactionId
  };
  this._updatesInitiated = { // key is transactionId
  };
}

function checkHash() {
  return true;
}

Peer.prototype._handleInitiateUpdate = function(msgObj) {
  if (msgObj.previousHash != this._ledger[this._ledger.length-1].hash) {
    // reject it!
    return;
  }
  if (!checkHash(msgObj)) {
    // reject it!
    return;
  }
  this._ledger.push(msgObj);
  this._sendMsg({
    msgType: 'confirm-update',
    hash: msgObj.hash,
  });
};

Peer.prototype._handleConfirmUpdate = function(msgObj) {
  if (typeof this._updatesInitiated[msgObj.hash] === 'undefined') {
    // reject it!
    return;
  }
  this._ledger.push(this._updatesInitiated[msgObj.hash]);
  delete this._updatesInitiated[msgObj.hash];
};

Peer.prototype._handleConditionalPromise = function(msgObj) {
  this._conditionalPromises.rcvd[msgObj.asset.id] = msgObj;
  setTimeout(function() {
    if (typeof this._conditionalPromises.rcvd[msgObj.asset.id] === 'undefined') {
      // was rejected in the meantime
      return;
    }
    this._conditionalPromises.rcvd[msgObj.asset.id].challengeReused = true;
    this._sendToRouting(msgObj.routing, msgObj.challenge);
  }, 100);
};

Peer.prototype._handleSatisfyCondition = function(msgObj) {
  if (typeof this._conditionalPromises.sent[msgObj.assetId] === 'undefined') {
    // reject
    return;
  }
  var condProm = this._conditionalPromises.sent[msgObj.assetId];
  if (!Challenge.check(condProm.challenge, msgObj.solution)) {
    // reject
    return;
  }
  condProm.solution = msgObj.solution;
  condProm.previousHash = this._ledger[this._ledger.length].hash;
  condProm.hash = calcHash(condProm);
  this._ledger.push(condProm);
  this._sendMsg({
    type: 'confirm-update',
    hash: condProm.hash,
  });
  this._sendToRouting(msgObj.routing, msgObj.solution);
};

Peer.prototype._handlePleaseReject = function(msgObj) {
  if (this._conditionalPromise.rcvd[msgObj.assetId].challengeReused) {
    this._sendToRouting(msgObj.routing, 'pls-rej');
  } else {
    delete this._conditionalPromise.rcvd[msgObj.assetId];
    this._sendMsg({
      type: 'reject',
      assetId: msgObj.assetId
    });
  }
};

Peer.prototype._handleReject = function(msgObj) {
  delete this._conditionalPromise.sent[msgObj.assetId];
  this._sendToRouting(msgObj.routing, 'reject');
};

Peer.prototype.handleIncomingMessage = function(msgObj) {
  switch(msgObj.msgType) {
  case 'initiate-update':
    return this._handleInitiateUpdate(msgObj); // to ledger
    // break;
  case 'confirm-update':
    return this._handleConfirmUpdate(msgObj); // to ledger
    // break;
  case 'update-status':
  case 'probe':
    return this._sendToRouting(msgObj); // to routing
    // break;
  case 'conditional-promise':
    return this._handleConditionalPromise(msgObj); // to ledger, wait 100ms, then passes challenge to internal-loop-peer
    // break;
  case 'satisfy-condition':
    return this._handleSatisfyCondition(msgObj); // to ledger and passes solution to internal-loop-peer
    // break;
  case 'please-reject':
    return this._handlePleaseReject(msgObj); // if conditional-promise still waiting, reject; if not, pass please-reject to internal-loop-peer
    // break;
  case 'reject':
    return this._handleReject(msgObj); // to internal-loop-peer
    // break;
  default:
    throw new Error(`Unknown msgType ${msgType}"`);
  }
};

module.exports = Peer;
