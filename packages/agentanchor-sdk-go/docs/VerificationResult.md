# VerificationResult

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Verified** | Pointer to **bool** |  | [optional] 
**ChainValid** | Pointer to **bool** | Whether chain integrity is intact | [optional] 
**Record** | Pointer to [**TruthChainRecord**](TruthChainRecord.md) |  | [optional] 
**VerificationUrl** | Pointer to **string** |  | [optional] 

## Methods

### NewVerificationResult

`func NewVerificationResult() *VerificationResult`

NewVerificationResult instantiates a new VerificationResult object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewVerificationResultWithDefaults

`func NewVerificationResultWithDefaults() *VerificationResult`

NewVerificationResultWithDefaults instantiates a new VerificationResult object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetVerified

`func (o *VerificationResult) GetVerified() bool`

GetVerified returns the Verified field if non-nil, zero value otherwise.

### GetVerifiedOk

`func (o *VerificationResult) GetVerifiedOk() (*bool, bool)`

GetVerifiedOk returns a tuple with the Verified field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetVerified

`func (o *VerificationResult) SetVerified(v bool)`

SetVerified sets Verified field to given value.

### HasVerified

`func (o *VerificationResult) HasVerified() bool`

HasVerified returns a boolean if a field has been set.

### GetChainValid

`func (o *VerificationResult) GetChainValid() bool`

GetChainValid returns the ChainValid field if non-nil, zero value otherwise.

### GetChainValidOk

`func (o *VerificationResult) GetChainValidOk() (*bool, bool)`

GetChainValidOk returns a tuple with the ChainValid field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetChainValid

`func (o *VerificationResult) SetChainValid(v bool)`

SetChainValid sets ChainValid field to given value.

### HasChainValid

`func (o *VerificationResult) HasChainValid() bool`

HasChainValid returns a boolean if a field has been set.

### GetRecord

`func (o *VerificationResult) GetRecord() TruthChainRecord`

GetRecord returns the Record field if non-nil, zero value otherwise.

### GetRecordOk

`func (o *VerificationResult) GetRecordOk() (*TruthChainRecord, bool)`

GetRecordOk returns a tuple with the Record field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRecord

`func (o *VerificationResult) SetRecord(v TruthChainRecord)`

SetRecord sets Record field to given value.

### HasRecord

`func (o *VerificationResult) HasRecord() bool`

HasRecord returns a boolean if a field has been set.

### GetVerificationUrl

`func (o *VerificationResult) GetVerificationUrl() string`

GetVerificationUrl returns the VerificationUrl field if non-nil, zero value otherwise.

### GetVerificationUrlOk

`func (o *VerificationResult) GetVerificationUrlOk() (*string, bool)`

GetVerificationUrlOk returns a tuple with the VerificationUrl field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetVerificationUrl

`func (o *VerificationResult) SetVerificationUrl(v string)`

SetVerificationUrl sets VerificationUrl field to given value.

### HasVerificationUrl

`func (o *VerificationResult) HasVerificationUrl() bool`

HasVerificationUrl returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


