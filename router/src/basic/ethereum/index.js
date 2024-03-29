'use strict';

const Web3 = require('web3');
const config = require('config');
const ethereum = require('./ethereum.js');
const fs = require('fs');
const utils = require('../../utils/utils.js');
const logger = require('../../utils/logger.js');

const OMNIVERSE_TOKEN_TRANSFER = 'OmniverseTokenTransfer';
const OMNIVERSE_TOKEN_APPROVAL = 'OmniverseTokenApproval';
const OMNIVERSE_TOKEN_TRANSFER_FROM = 'OmniverseTokenTransferFrom';
const OMNIVERSE_TOKEN_EXCEED_BALANCE = 'OmniverseTokenExceedBalance';
const OMNIVERSE_TOKEN_WRONG_OP = 'OmniverseTokenWrongOp';
const OMNIVERSE_NOT_OWNER = 'OmniverseNotOwner';
const OMNIVERSE_ERROR = 'OmniverseError';

class EthereumHandler {
  constructor(chainName) {
    this.chainName = chainName;
  }

  async init() {
    logger.info(utils.format("Init handler: {0}, compatible chain: {1}", this.chainName, "ethereum"));
    this.web3 = new Web3(config.get('networks.' + this.chainName + '.nodeAddress'));
    this.web3.eth.handleRevert = true;
    let secret = JSON.parse(fs.readFileSync(config.get('secret')));
    this.testAccountPrivateKey = secret[this.chainName];
    // OmniverseProtocol
    let omniverseProtocolContractAddress = config.get('networks.' + this.chainName + '.omniverseProtocolContractAddress');
    let omniverseProtocolRawData = fs.readFileSync(config.get('networks.' + this.chainName + '.omniverseProtocolAbiPath'));
    let omniverseProtocolAbi = JSON.parse(omniverseProtocolRawData).abi;
    this.omniverseProtocolContract = new this.web3.eth.Contract(omniverseProtocolAbi, omniverseProtocolContractAddress);
    // SkywalkerFungible
    let skywalkerFungibleContractAddress = config.get('networks.' + this.chainName + '.skywalkerFungibleContractAddress');
    let skywalkerFungibleRawData = fs.readFileSync(config.get('networks.' + this.chainName + '.skywalkerFungibleAbiPath'));
    let skywalkerFungibleAbi = JSON.parse(skywalkerFungibleRawData).abi;
    this.skywalkerFungibleContract = new this.web3.eth.Contract(skywalkerFungibleAbi, skywalkerFungibleContractAddress);
    this.chainId = config.get('networks.' + this.chainName + '.chainId');
    this.messages = [];

    for (let i = 0; i < skywalkerFungibleAbi.length; i++) {
      if (skywalkerFungibleAbi[i].type == 'event' && skywalkerFungibleAbi[i].name == OMNIVERSE_TOKEN_TRANSFER) {
        this.eventOmniverseTokenTransfer = skywalkerFungibleAbi[i];
        this.eventOmniverseTokenTransfer.signature = this.web3.eth.abi.encodeEventSignature(this.eventOmniverseTokenTransfer);
      }
      else if (skywalkerFungibleAbi[i].type == 'event' && skywalkerFungibleAbi[i].name == OMNIVERSE_TOKEN_APPROVAL) {
        this.eventOmniverseTokenApproval = skywalkerFungibleAbi[i];
        this.eventOmniverseTokenApproval.signature = this.web3.eth.abi.encodeEventSignature(this.eventOmniverseTokenApproval);
      }
      else if (skywalkerFungibleAbi[i].type == 'event' && skywalkerFungibleAbi[i].name == OMNIVERSE_TOKEN_TRANSFER_FROM) {
        this.eventOmniverseTokenTransferFrom = skywalkerFungibleAbi[i];
        this.eventOmniverseTokenTransferFrom.signature = this.web3.eth.abi.encodeEventSignature(this.eventOmniverseTokenTransferFrom);
      }
      else if (skywalkerFungibleAbi[i].type == 'event' && skywalkerFungibleAbi[i].name == OMNIVERSE_TOKEN_EXCEED_BALANCE) {
        this.eventOmniverseTokenExceedBalance = skywalkerFungibleAbi[i];
        this.eventOmniverseTokenExceedBalance.signature = this.web3.eth.abi.encodeEventSignature(this.eventOmniverseTokenExceedBalance);
      }
      else if (skywalkerFungibleAbi[i].type == 'event' && skywalkerFungibleAbi[i].name == OMNIVERSE_TOKEN_WRONG_OP) {
        this.eventOmniverseTokenWrongOp = skywalkerFungibleAbi[i];
        this.eventOmniverseTokenWrongOp.signature = this.web3.eth.abi.encodeEventSignature(this.eventOmniverseTokenWrongOp);
      }
      else if (skywalkerFungibleAbi[i].type == 'event' && skywalkerFungibleAbi[i].name == OMNIVERSE_NOT_OWNER) {
        this.eventOmniverseNotOwner = skywalkerFungibleAbi[i];
        this.eventOmniverseNotOwner.signature = this.web3.eth.abi.encodeEventSignature(this.eventOmniverseNotOwner);
      }
      else if (skywalkerFungibleAbi[i].type == 'event' && skywalkerFungibleAbi[i].name == OMNIVERSE_ERROR) {
        this.eventOmniverseError = skywalkerFungibleAbi[i];
        this.eventOmniverseError.signature = this.web3.eth.abi.encodeEventSignature(this.eventOmniverseError);
      }
    }
  }

  async addMessageToList(message) {
    // to be continued, encoding is needed here for omniverse
    this.messages.push(message);
  }

  async pushMessages() {
    for (let i = 0; i < this.messages.length; i++) {
      await ethereum.sendTransaction(this.web3, this.chainId, this.skywalkerFungibleContract, 'omniverseTransfer',
        this.testAccountPrivateKey, [this.messages[i]]);
    }
    this.messages = [];
  }

  async tryTrigger() {
    while (true) {
      let ret = await ethereum.contractCall(this.skywalkerFungibleContract, 'getExecutableDelayedTx', []);
      if (ret.sender != '0x') {
        logger.debug('Delayed transaction', ret);
        let receipt = await ethereum.sendTransaction(this.web3, this.chainId, this.skywalkerFungibleContract, 'triggerExecution',
          this.testAccountPrivateKey, []);
        logger.debug(receipt.logs[0].topics, receipt.logs[0].data);
        for (let i = 0; i < receipt.logs.length; i++) {
          let log = receipt.logs[i];
          if (log.address == this.skywalkerFungibleContract._address) {
            if (log.topics[0] == this.eventOmniverseError.signature) {
              let decodedLog = this.web3.eth.abi.decodeLog(this.eventOmniverseError.inputs, log.data, log.topics.slice(1));
              logger.info(utils.format('Execute failed: sent by {0}, the reason is {1}.',
                decodedLog.sender, decodedLog.reason));
            }
            else if (log.topics[0] == this.eventOmniverseNotOwner.signature) {
              let decodedLog = this.web3.eth.abi.decodeLog(this.eventOmniverseNotOwner.inputs, log.data, log.topics.slice(1));
              logger.info(utils.format('Execute failed due to not owner: sent by {0}.', decodedLog.sender));
            }
            else if (log.topics[0] == this.eventOmniverseNotOwner.signature) {
              let decodedLog = this.web3.eth.abi.decodeLog(this.eventOmniverseNotOwner.inputs, log.data, log.topics.slice(1));
              logger.info(utils.format('Execute failed due to wrong Op: sent by {0}, the op code is {1}.',
                decodedLog.sender, decodedLog.op));
            }
            else if (log.topics[0] == this.eventOmniverseTokenExceedBalance.signature) {
              let decodedLog = this.web3.eth.abi.decodeLog(this.eventOmniverseTokenExceedBalance.inputs, log.data, log.topics.slice(1));
              logger.info(utils.format('Execute failed due to exceeding balance: {0} is needed from {1}, which only has {2}.',
                decodedLog.value, decodedLog.owner, decodedLog.balance));
            }
            else if (log.topics[0] == this.eventOmniverseTokenTransferFrom.signature) {
              let decodedLog = this.web3.eth.abi.decodeLog(this.eventOmniverseTokenTransferFrom.inputs, log.data, log.topics.slice(1));
              logger.info(utils.format('Execute OmniverseTransferFrom successfully: transfer {0} from {1} to {2}.',
                decodedLog.value, decodedLog.from, decodedLog.to));
            }
            else if (log.topics[0] == this.eventOmniverseTokenApproval.signature) {
              let decodedLog = this.web3.eth.abi.decodeLog(this.eventOmniverseTokenApproval.inputs, log.data, log.topics.slice(1));
              logger.info(utils.format('Execute OmniverseApprove successfully: {0} approve {1} for {2}.',
                decodedLog.owner, decodedLog.spender, decodedLog.value));
            }
            else if (log.topics[0] == this.eventOmniverseTokenTransfer.signature) {
              let decodedLog = this.web3.eth.abi.decodeLog(this.eventOmniverseTokenTransfer.inputs, log.data, log.topics.slice(1));
              logger.info(utils.format('Execute OmniverseTransfer successfully: {0} transfer {1} to {2}.',
                decodedLog.from, decodedLog.value, decodedLog.to));
            }
          }
        }
      }
      else {
        break;
      }
    }
  }

  start(callback) {
    this.omniverseProtocolContract.events.TransactionSent()
    .on("connected", (subscriptionId) => {
      logger.info('connected', subscriptionId);
    })
    .on('data', async (event) => {
      logger.debug('event', event);
      // to be continued, decoding is needed here for omniverse
      let message = await ethereum.contractCall(this.omniverseProtocolContract, 'getTransactionData', [event.returnValues.pk, event.returnValues.nonce]);
      let members = await ethereum.contractCall(this.skywalkerFungibleContract, 'getMembers', []);
      callback(message.txData, members);
    })
    .on('changed', (event) => {
      // remove event from local database
      logger.info('changed');
      logger.debug(event);
    })
    .on('error', (error, receipt) => {
      // If the transaction was rejected by the network with a receipt, the second parameter will be the receipt.
      logger.info('error', error);
      logger.info(receipt);
    });
  }

  getProvider() {
    return this.web3;
  }
}

module.exports = EthereumHandler;