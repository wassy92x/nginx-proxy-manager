/// <reference types="cypress" />

describe('Client CA endpoints', () => {
	let token;
	let caId;
	let certId;
	let accessListId;

	before(() => {
		cy.resetUsers();
		cy.getToken().then((tok) => {
			token = tok;
		});
	});

	it('Should be able to create a Client CA', () => {
		cy.task('backendApiPost', {
			token: token,
			path:  '/api/nginx/client-cas',
			data:  {
				name:          'Cypress CA',
				validity_days: 365,
			},
		}).then((data) => {
			cy.validateSwaggerSchema('post', 201, '/nginx/client-cas', data);
			expect(data).to.have.property('id');
			expect(data.id).to.be.greaterThan(0);
			expect(data.meta).to.have.property('fingerprint');
			// The CA certificate and key are kept on the file system, not in the API object
			expect(data).to.not.have.property('certificate');
			expect(data).to.not.have.property('private_key');
			caId = data.id;
		});
	});

	it('Should not accept a validity below the minimum', () => {
		cy.task('backendApiPost', {
			token:         token,
			path:          '/api/nginx/client-cas',
			data:          {
				name:          'Too Short',
				validity_days: 5,
			},
			returnOnError: true,
		}).then((data) => {
			expect(data.error.code).to.equal(400);
		});
	});

	it('Should be able to get all Client CAs', () => {
		cy.task('backendApiGet', {
			token: token,
			path:  '/api/nginx/client-cas?expand=owner',
		}).then((data) => {
			cy.validateSwaggerSchema('get', 200, '/nginx/client-cas', data);
			expect(data.length).to.be.greaterThan(0);
			data.forEach((ca) => {
				expect(ca).to.not.have.property('private_key');
			});
		});
	});

	it('Should be able to update a Client CA', () => {
		cy.task('backendApiPut', {
			token: token,
			path:  `/api/nginx/client-cas/${caId}`,
			data:  {
				name: 'Cypress CA Renamed',
			},
		}).then((data) => {
			cy.validateSwaggerSchema('put', 200, '/nginx/client-cas/{caID}', data);
			expect(data.name).to.equal('Cypress CA Renamed');
		});
	});

	it('Should be able to renew a Client CA', () => {
		cy.task('backendApiPost', {
			token: token,
			path:  `/api/nginx/client-cas/${caId}/renew`,
		}).then((data) => {
			cy.validateSwaggerSchema('post', 200, '/nginx/client-cas/{caID}/renew', data);
			expect(data.meta).to.have.property('renewed_on');
		});
	});

	it('Should issue a client certificate with a freshly generated key', () => {
		cy.task('backendApiPost', {
			token: token,
			path:  `/api/nginx/client-cas/${caId}/certificates`,
			data:  {
				name:          'cypress-client',
				validity_days: 30,
				format:        'pem',
			},
		}).then((data) => {
			expect(data).to.contain('BEGIN PRIVATE KEY');
			expect(data).to.contain('BEGIN CERTIFICATE');
		});
	});

	it('Should require a password for PKCS#12 files', () => {
		cy.task('backendApiPost', {
			token:         token,
			path:          `/api/nginx/client-cas/${caId}/certificates`,
			data:          {
				name:          'cypress-client',
				validity_days: 30,
				format:        'pkcs12',
			},
			returnOnError: true,
		}).then((data) => {
			expect(data.error.code).to.equal(400);
		});
	});

	it('Should list the issued client certificates', () => {
		cy.task('backendApiGet', {
			token: token,
			path:  `/api/nginx/client-cas/${caId}/certificates`,
		}).then((data) => {
			cy.validateSwaggerSchema('get', 200, '/nginx/client-cas/{caID}/certificates', data);
			expect(data.length).to.equal(1);
			expect(data[0].name).to.equal('cypress-client');
			expect(data[0].revoked).to.equal(false);
			expect(data[0]).to.not.have.property('private_key');
			certId = data[0].id;
		});
	});

	it('Should be able to revoke a client certificate', () => {
		cy.task('backendApiPost', {
			token: token,
			path:  `/api/nginx/client-cas/${caId}/certificates/${certId}/revoke`,
		}).then((data) => {
			cy.validateSwaggerSchema('post', 200, '/nginx/client-cas/{caID}/certificates/{certID}/revoke', data);
			expect(data.revoked).to.equal(true);
		});
	});

	it('Should be able to require mTLS in an Access List', () => {
		cy.task('backendApiPost', {
			token: token,
			path:  '/api/nginx/access-lists',
			data:  {
				name:          'Cypress mTLS',
				satisfy_any:   false,
				pass_auth:     false,
				items:         [],
				clients:       [],
				client_ca_ids: [caId],
			},
		}).then((data) => {
			cy.validateSwaggerSchema('post', 201, '/nginx/access-lists', data);
			expect(data.client_cas.length).to.equal(1);
			expect(data.client_cas[0].id).to.equal(caId);
			expect(data.client_cas[0]).to.not.have.property('private_key');
			accessListId = data.id;
		});
	});

	it('Should not delete a Client CA that is used by an Access List', () => {
		cy.task('backendApiDelete', {
			token:         token,
			path:          `/api/nginx/client-cas/${caId}`,
			returnOnError: true,
		}).then((data) => {
			expect(data.error.code).to.equal(400);
		});
	});

	it('Should be able to delete a Client CA once it is unused', () => {
		cy.task('backendApiPut', {
			token: token,
			path:  `/api/nginx/access-lists/${accessListId}`,
			data:  {
				client_ca_ids: [],
			},
		}).then((data) => {
			expect(data.client_cas.length).to.equal(0);

			cy.task('backendApiDelete', {
				token: token,
				path:  `/api/nginx/client-cas/${caId}`,
			}).then((result) => {
				expect(result).to.be.equal(true);
			});
		});
	});
});
