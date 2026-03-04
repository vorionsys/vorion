# TruthChainRecord

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | Pointer to **string** |  | [optional] 
**Sequence** | Pointer to **int32** | Position in chain | [optional] 
**RecordType** | Pointer to **string** |  | [optional] 
**AgentId** | Pointer to **string** |  | [optional] 
**Hash** | Pointer to **string** | SHA-256 hash of record | [optional] 
**PreviousHash** | Pointer to **string** | Hash of previous record | [optional] 
**Data** | Pointer to **map[string]interface{}** | Record payload | [optional] 
**Timestamp** | Pointer to **time.Time** |  | [optional] 

## Methods

### NewTruthChainRecord

`func NewTruthChainRecord() *TruthChainRecord`

NewTruthChainRecord instantiates a new TruthChainRecord object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewTruthChainRecordWithDefaults

`func NewTruthChainRecordWithDefaults() *TruthChainRecord`

NewTruthChainRecordWithDefaults instantiates a new TruthChainRecord object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *TruthChainRecord) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *TruthChainRecord) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *TruthChainRecord) SetId(v string)`

SetId sets Id field to given value.

### HasId

`func (o *TruthChainRecord) HasId() bool`

HasId returns a boolean if a field has been set.

### GetSequence

`func (o *TruthChainRecord) GetSequence() int32`

GetSequence returns the Sequence field if non-nil, zero value otherwise.

### GetSequenceOk

`func (o *TruthChainRecord) GetSequenceOk() (*int32, bool)`

GetSequenceOk returns a tuple with the Sequence field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSequence

`func (o *TruthChainRecord) SetSequence(v int32)`

SetSequence sets Sequence field to given value.

### HasSequence

`func (o *TruthChainRecord) HasSequence() bool`

HasSequence returns a boolean if a field has been set.

### GetRecordType

`func (o *TruthChainRecord) GetRecordType() string`

GetRecordType returns the RecordType field if non-nil, zero value otherwise.

### GetRecordTypeOk

`func (o *TruthChainRecord) GetRecordTypeOk() (*string, bool)`

GetRecordTypeOk returns a tuple with the RecordType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRecordType

`func (o *TruthChainRecord) SetRecordType(v string)`

SetRecordType sets RecordType field to given value.

### HasRecordType

`func (o *TruthChainRecord) HasRecordType() bool`

HasRecordType returns a boolean if a field has been set.

### GetAgentId

`func (o *TruthChainRecord) GetAgentId() string`

GetAgentId returns the AgentId field if non-nil, zero value otherwise.

### GetAgentIdOk

`func (o *TruthChainRecord) GetAgentIdOk() (*string, bool)`

GetAgentIdOk returns a tuple with the AgentId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAgentId

`func (o *TruthChainRecord) SetAgentId(v string)`

SetAgentId sets AgentId field to given value.

### HasAgentId

`func (o *TruthChainRecord) HasAgentId() bool`

HasAgentId returns a boolean if a field has been set.

### GetHash

`func (o *TruthChainRecord) GetHash() string`

GetHash returns the Hash field if non-nil, zero value otherwise.

### GetHashOk

`func (o *TruthChainRecord) GetHashOk() (*string, bool)`

GetHashOk returns a tuple with the Hash field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetHash

`func (o *TruthChainRecord) SetHash(v string)`

SetHash sets Hash field to given value.

### HasHash

`func (o *TruthChainRecord) HasHash() bool`

HasHash returns a boolean if a field has been set.

### GetPreviousHash

`func (o *TruthChainRecord) GetPreviousHash() string`

GetPreviousHash returns the PreviousHash field if non-nil, zero value otherwise.

### GetPreviousHashOk

`func (o *TruthChainRecord) GetPreviousHashOk() (*string, bool)`

GetPreviousHashOk returns a tuple with the PreviousHash field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPreviousHash

`func (o *TruthChainRecord) SetPreviousHash(v string)`

SetPreviousHash sets PreviousHash field to given value.

### HasPreviousHash

`func (o *TruthChainRecord) HasPreviousHash() bool`

HasPreviousHash returns a boolean if a field has been set.

### GetData

`func (o *TruthChainRecord) GetData() map[string]interface{}`

GetData returns the Data field if non-nil, zero value otherwise.

### GetDataOk

`func (o *TruthChainRecord) GetDataOk() (*map[string]interface{}, bool)`

GetDataOk returns a tuple with the Data field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetData

`func (o *TruthChainRecord) SetData(v map[string]interface{})`

SetData sets Data field to given value.

### HasData

`func (o *TruthChainRecord) HasData() bool`

HasData returns a boolean if a field has been set.

### GetTimestamp

`func (o *TruthChainRecord) GetTimestamp() time.Time`

GetTimestamp returns the Timestamp field if non-nil, zero value otherwise.

### GetTimestampOk

`func (o *TruthChainRecord) GetTimestampOk() (*time.Time, bool)`

GetTimestampOk returns a tuple with the Timestamp field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTimestamp

`func (o *TruthChainRecord) SetTimestamp(v time.Time)`

SetTimestamp sets Timestamp field to given value.

### HasTimestamp

`func (o *TruthChainRecord) HasTimestamp() bool`

HasTimestamp returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


