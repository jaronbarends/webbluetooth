/*
* A wrapper around the Web bluetooth API
*/

import util from './util/util.js';

export default class WebBluetooth {

	constructor() {
		this._debug = true;
		this._util = util;
		this._resetDeviceEnvironment();
	}
	

	/**
	* reset all device environment variables
	* @returns {undefined}
	*/
	_resetDeviceEnvironment() {
		this._deviceObj = null;
		this._gattServer = null;
		this._services = new Map();// all services we've connected with
		this._characteristics = new Map();// all characteristics we've found
	};

	
	/**
	* connect with a peripheral device
	* for security reasons, every service you want to use, MUST be specified
	* in either options.filters.services or options.optionalServices
	* https://webbluetoothcg.github.io/web-bluetooth/#dom-requestdeviceoptions-optionalservices
	* @param {Object} [options={}]
	* @param {Array} [options.filters] - Filters to apply on returned list of devices
	* @param {Array} [options.filters.services] - Array of UUIDs of services the device has to advertise
	* @param {String} [options.filters.name] - The name of the device
	* @param {String} [options.filters.namePrefix] - The starting characters of the device name
	* @param {Array} [options.optionalServices] - Array of UUIDs of optional services the device has to offer
	* @returns {Boolean}
	*/
	async connect(options = {}) {
		this._resetDeviceEnvironment();
		if (!options.filters) {
			options.acceptAllDevices = true;
		}

		try {
			this._deviceObj = await navigator.bluetooth.requestDevice(options);
			this._gattServer = await this._deviceObj.gatt.connect();

			// get all requested required services and cache them
			await this._getRequiredServices(options);
			return true;
		} catch(error) {
			this._error(`Something went wrong while connecting`, error);
			return false;
		}
	}


	/**
	* disconnect the device
	* @returns {undefined}
	*/
	disconnect() {
		if (this.isConnected) {
			this._gattServer.disconnect();
			this._resetDeviceEnvironment();
		} else {
			this._warn(`Disconnect called, but device was not connected`);
		}
	};


	/**
	* write a value to a characteristic
	* may be called with two possible parameter comibinations
	* 1) characteristic and value
	*    @param {BluetoothRemoteGATTCharacteristic} characteristicOrServiceUUID - The characteristic, or the UUID of the service the characteristic belongs to
	*    @param {Number} characteristicUUIDorValue - The value to write
	*    @param {Number} [value] - Will be ignored (only necessary when called in other way)
	* 2) serviceUUID, characteristicUUID, value
	*    @param {String} serviceUuid - The UUID of the service the characteristic belongs to
	*    @param {String} characteristicUuid - The UUID of the characteristic to write to
	*    @param {Number} value - The value to write
	* @returns {Promise} Promise resolving to value
	*/
	async writeValue(characteristicOrServiceUUID, characteristicUUIDorValue, value) {
		const characteristic = await this._getCharacteristicFromUnkownParam(characteristicOrServiceUUID, characteristicUUIDorValue);
		const theValue = (characteristicOrServiceUUID instanceof BluetoothRemoteGATTCharacteristic) ? characteristicUUIDorValue : value;
		try {
			return await characteristic.writeValue(theValue);
		} catch(error) {
			this._error(`Couldn't write value`, error);
		}
	};


	/**
	* read a value from a characteristic
	* may be called with two possible parameter comibinations
	* 1) characteristic and optional return type
	*    @param {BluetoothRemoteGATTCharacteristic} characteristicOrServiceUUID - The characteristic, or the UUID of the service the characteristic belongs to
	*    @param {dataType} [characteristicUUIDorReturnType] - The data type of the return value: DataView, String or Uint8Array
	*    @param {dataType} [returnType] - Will be ignored (only necessary when called in other way)
	* 2) serviceUUID, characteristicUUID, optional return type (should be used if you don't have reference to characteristic yet)
	*    @param {String} characteristicOrServiceUUID - The UUID of the service the characteristic belongs to
	*    @param {String} characteristicUUIDorReturnType - The UUID of the characteristic to read from
	*    @param {dataType} [returnType] - The data type of the return value: DataView, String or Uint8Array
	* @returns {Promise} Promise resolving to value (DataView, String or Array)
	*/
	async readValue(characteristicOrServiceUUID, characteristicUUIDorReturnType = DataView, returnType = DataView) {
		// check param types
		const characteristic = await this._getCharacteristicFromUnkownParam(characteristicOrServiceUUID, characteristicUUIDorReturnType);
		returnType = (characteristicOrServiceUUID instanceof BluetoothRemoteGATTCharacteristic) ? characteristicUUIDorReturnType : returnType;

		try {
			if (characteristic.properties.read) {
				return await characteristic.readValue()
					.then((dataView) => {
						let value = dataView;
						if (returnType !== DataView) {
							if (returnType === String) {
								value = util.transform.dataViewToString(dataView);
							} else if (returnType === Uint8Array) {
								value = this.util.transform.dataViewToUint8Array(dataView);
							}
						}
						return value;
					});
			} else {
				this._warn('characteristic does not support read: ', this._getOperationsString(characteristic));
			}
		} catch(error) {
			this._error(`Couldn't read value: `, error);
		}
	};


	/**
	* get a characteristic from the device
	* @param {String | Number} serviceUuid - The UUID of the service to retrieve
	* @returns {Promise} Promise resolving to BluetoothGATTService
	*/
	async getService(serviceUuid) {
		if (!this.isConnected) {
			throw new Error('Device not connected');
		}

		// check if we've already got this service
		let service = this._services.get(serviceUuid);
		if (typeof service === 'undefined') {
			// this service hasn't been requested yet
			try {
				service = await this._gattServer.getPrimaryService(serviceUuid);
				// cache for later use
				this._services.set(serviceUuid, service);
			} catch(error) {
				this._error(`Error getting service`, error);
				throw error;
			}
		}
		return service;
	};


	/**
	* get a characteristic from the device
	* @param {string} serviceUuid - The UUID of the service the characteristic belongs to
	* @param {string} characteristicUuid - The UUID of the characteristic to retrieve
	* @returns {Promise} Promise resolving to BluetoothGATTCharacteristic
	*/
	async getCharacteristic(serviceUuid, characteristicUuid) {
		if (!this.isConnected) {
			throw new Error('Device not connected');
		}

		// check if we've already got this characteristic
		let characteristic = this._characteristics.get(characteristicUuid);
		if (typeof characteristic === 'undefined') {
			// this characteristic hasn't been requested yet
			try {
				const service = await this.getService(serviceUuid);
				characteristic = await service.getCharacteristic(characteristicUuid);
				// cache for later use
				this._characteristics.set(characteristicUuid, characteristic);
			} catch(error) {
				this._error(`Error getting characteristic`, error);
				throw error;
			}
		}
		return characteristic;
	};

	
	//-- Start getters / setters

		get util() {
			return this._util;
		}

		/**
		* get this device's deviceObj's id
		* @returns {undefined}
		*/
		get id() {
			return this._deviceObj.id;
		};


		/**
		* get the device's name
		* @returns {String} Return the name of the device
		*/
		get name() {
			return this._deviceObj.name;
		};


		/**
		* get this devices gattServer
		* @returns {undefined}
		*/
		get gatt() {
			return this._gattServer;
		}


		/*
		* get the "real" BluetoothDevice object
		*/
		get deviceObj() {
			return this._deviceObj
		}

		
		/**
		* check if device is connected
		* @returns {Boolean}
		*/
		get isConnected() {
			// return this._deviceObj && this._deviceObj.gatt.connected;
			return this._gattServer && this._gattServer.connected;
		};

	//-- End getters / setters ----


	//-- Start private functions


		/**
		* get the required services that were requested at connection time and cache them
		* @param {object} options - The options passed to connect()
		* @returns {undefined}
		*/
		async _getRequiredServices(options) {
			const requiredServices = (options.filters && options.filters.services) ? options.filters : [];

			// we could also cache optional services
			// chosen not to do that for now - leave code here in case I change my mind
			// const optionalServices = options.optionalServices || [];
			// requiredServices = requiredServices.concat(optionalServices);

			const reqServicesPromises = [];
			requiredServices.forEach((service) => {
				// no await, because we want it fast
				reqServicesPromises.push(this.getService(service));
			});

			return Promise.all(reqServicesPromises)
				.then(() => { this._log(`got all required services for ${this.name}`) })
				.catch((err) => this._error(err.message, err));
		};


		/**
		* readValue and writeValue can both be called with either a characteristic as param, or a serviceUUID and a characteristicUUID to retrieve that characteristic.
		* this method gets the appropriate characteristic
		* @param {BluetoothRemoteGATTCharacteristic} characteristicOrServiceUUID
		* @returns {Promise} Promise resolving to BluetoothGATTCharacteristic
		*/
		async _getCharacteristicFromUnkownParam(characteristicOrServiceUUID, characteristicUUID) {
			let characteristic;
			if (characteristicOrServiceUUID instanceof BluetoothRemoteGATTCharacteristic) {
				// we got characteristic and optional returnType
				characteristic = characteristicOrServiceUUID;
			} else {
				// we got serviceUuid and characteristicUuid
				const serviceUuid = characteristicOrServiceUUID;
				const characteristicUuid = characteristicUUID;
				characteristic = await this.getCharacteristic(serviceUuid, characteristicUuid);
			}
			return characteristic;
		};

		
		/**
		* get a string with characteristic's operations and their value (read, write, notify)
		* @param {characteristic} char - The characteristic
		* @returns {undefined}
		*/
		_getOperationsString(characteristic) {
			return `Read: ${characteristic.properties.read}; Write: ${characteristic.properties.write}; Notify: ${characteristic.properties.notify}`;
		};


	//-- helper functions


		/**
		* log a message to the console
		* @param {string} msg - Your message
		* @returns {undefined}
		*/
		_log(msg) {
			if (this._debug) {
				console.log(msg);
			}
		};

		/**
		* log a warning to the console
		* @param {string} msg - Your message
		* @returns {undefined}
		*/
		_warn(msg) {
			if (this._debug) {
				console.warn(msg);
			}
		};

		/**
		* log an error to the console
		* @param {string} msg - Your custom error message
		* @param {Error} error - The error that was thrown
		* @returns {undefined}
		*/
		_error(msg, error) {
			if (this._debug) {
				console.error(`${msg}\n ${error.name}: ${error.message}`);
			}
		};

}
