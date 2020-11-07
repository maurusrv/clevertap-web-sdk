import { CLEAR, LCOOKIE_NAME } from '../util/constants'
import { isObjectEmpty, isValueValid, removeUnsupportedChars } from '../util/datatypes'
import { getNow } from '../util/datetime'
import RequestDispatcher from '../util/requestDispatcher'
import { StorageManager } from '../util/storage'
import { addToURL } from '../util/url'

let seqNo = 0
let requestTime = 0

export default class RequestManager {
  #logger
  #account
  #device
  #session
  #isPersonalisationActive
  #clearCookie = false
  processingBackup = false

  constructor ({ logger, account, device, session, isPersonalisationActive }) {
    this.#logger = logger
    this.#account = account
    this.#device = device
    this.#session = session
    this.#isPersonalisationActive = isPersonalisationActive

    RequestDispatcher.logger = logger
    RequestDispatcher.device = device
  }

  processBackupEvents () {
    const backupMap = StorageManager.readFromLSorCookie(LCOOKIE_NAME)
    if (typeof backupMap === 'undefined' || backupMap === null) {
      return
    }
    this.processingBackup = true
    for (const idx in backupMap) {
      if (backupMap.hasOwnProperty(idx)) {
        const backupEvent = backupMap[idx]
        if (typeof backupEvent.fired === 'undefined') {
          this.#logger.debug('Processing backup event : ' + backupEvent.q)
          if (typeof backupEvent.q !== 'undefined') {
            RequestDispatcher.fireRequest(backupEvent.q)
          }
          backupEvent.fired = true
        }
      }
    }

    StorageManager.saveToLSorCookie(LCOOKIE_NAME, backupMap)
    this.processingBackup = false
  }

  addSystemDataToObject (dataObject, ignoreTrim) {
    // ignore trim for chrome notifications; undefined everywhere else
    if (typeof ignoreTrim === 'undefined') {
      dataObject = removeUnsupportedChars(dataObject, this.#logger)
    }

    if (!isObjectEmpty(this.#logger.wzrkError)) {
      dataObject.wzrk_error = this.#logger.wzrkError
      this.#logger.wzrkError = {}
    }

    dataObject.id = this.#account.id

    if (isValueValid(this.#device.gcookie)) {
      dataObject.g = this.#device.gcookie
    }

    const obj = this.#session.getSessionCookieObject()
    dataObject.s = obj.s // session cookie
    dataObject.pg = (typeof obj.p === 'undefined') ? 1 : obj.p // Page count

    return dataObject
  }

  addFlags (data) {
    // check if cookie should be cleared.
    this.#clearCookie = StorageManager.getAndClearMetaProp(CLEAR)
    if (this.#clearCookie !== undefined && this.#clearCookie) {
      data.rc = true
      this.#logger.debug('reset cookie sent in request and cleared from meta for future requests.')
    }
    if (this.#isPersonalisationActive()) {
      const lastSyncTime = StorageManager.getMetaProp('lsTime')
      const expirySeconds = StorageManager.getMetaProp('exTs')

      // dsync not found in local storage - get data from server
      if (typeof lastSyncTime === 'undefined' || typeof expirySeconds === 'undefined') {
        data.dsync = true
        return
      }
      const now = getNow()
      // last sync time has expired - get fresh data from server
      if (lastSyncTime + expirySeconds < now) {
        data.dsync = true
      }
    }
  }

  saveAndFireRequest (url, override, sendOULFlag) {
    const now = getNow()
    url = addToURL(url, 'rn', ++window.$ct.globalCache.REQ_N)
    const data = url + '&i=' + now + '&sn=' + seqNo
    this.#backupEvent(data, window.$ct.globalCache.REQ_N)

    if (!window.$ct.blockRequest || override || (this.#clearCookie !== undefined && this.#clearCookie)) {
      if (now === requestTime) {
        seqNo++
      } else {
        requestTime = now
        seqNo = 0
      }

      RequestDispatcher.fireRequest(data, false, sendOULFlag)
    } else {
      this.#logger.debug(`Not fired due to block request - ${window.$ct.blockRequest} or clearCookie - ${this.#clearCookie}`)
    }
  }

  #backupEvent (data, reqNo) {
    let backupArr = StorageManager.readFromLSorCookie(LCOOKIE_NAME)
    if (typeof backupArr === 'undefined') {
      backupArr = {}
    }
    backupArr[reqNo] = { q: data }
    StorageManager.saveToLSorCookie(LCOOKIE_NAME, backupArr)
    this.#logger.debug(`stored in ${LCOOKIE_NAME} reqNo : ${reqNo} -> ${data}`)
  }
}
