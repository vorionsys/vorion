# CreateTruthChainRecordRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**RecordType** | **string** |  | 
**AgentId** | Pointer to **string** |  | [optional] 
**Data** | **map[string]interface{}** |  | 

## Methods

### NewCreateTruthChainRecordRequest

`func NewCreateTruthChainRecordRequest(recordType string, data map[string]interface{}, ) *CreateTruthChainRecordRequest`

NewCreateTruthChainRecordRequest instantiates a new CreateTruthChainRecordRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewCreateTruthChainRecordRequestWithDefaults

`func NewCreateTruthChainRecordRequestWithDefaults() *CreateTruthChainRecordRequest`

NewCreateTruthChainRecordRequestWithDefaults instantiates a new CreateTruthChainRecordRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetRecordType

`func (o *CreateTruthChainRecordRequest) GetRecordType() string`

GetRecordType returns the RecordType field if non-nil, zero value otherwise.

### GetRecordTypeOk

`func (o *CreateTruthChainRecordRequest) GetRecordTypeOk() (*string, bool)`

GetRecordTypeOk returns a tuple with the RecordType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRecordType

`func (o *CreateTruthChainRecordRequest) SetRecordType(v string)`

SetRecordType sets RecordType field to given value.


### GetAgentId

`func (o *CreateTruthChainRecordRequest) GetAgentId() string`

GetAgentId returns the AgentId field if non-nil, zero value otherwise.

### GetAgentIdOk

`func (o *CreateTruthChainRecordRequest) GetAgentIdOk() (*string, bool)`

GetAgentIdOk returns a tuple with the AgentId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAgentId

`func (o *CreateTruthChainRecordRequest) SetAgentId(v string)`

SetAgentId sets AgentId field to given value.

### HasAgentId

`func (o *CreateTruthChainRecordRequest) HasAgentId() bool`

HasAgentId returns a boolean if a field has been set.

### GetData

`func (o *CreateTruthChainRecordRequest) GetData() map[string]interface{}`

GetData returns the Data field if non-nil, zero value otherwise.

### GetDataOk

`func (o *CreateTruthChainRecordRequest) GetDataOk() (*map[string]interface{}, bool)`

GetDataOk returns a tuple with the Data field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetData

`func (o *CreateTruthChainRecordRequest) SetData(v map[string]interface{})`

SetData sets Data field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


