# ObserverEvent

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | Pointer to **string** |  | [optional] 
**EventType** | Pointer to **string** |  | [optional] 
**AgentId** | Pointer to **string** |  | [optional] 
**Severity** | Pointer to **string** |  | [optional] 
**Data** | Pointer to **map[string]interface{}** |  | [optional] 
**Hash** | Pointer to **string** |  | [optional] 
**Timestamp** | Pointer to **time.Time** |  | [optional] 

## Methods

### NewObserverEvent

`func NewObserverEvent() *ObserverEvent`

NewObserverEvent instantiates a new ObserverEvent object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewObserverEventWithDefaults

`func NewObserverEventWithDefaults() *ObserverEvent`

NewObserverEventWithDefaults instantiates a new ObserverEvent object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *ObserverEvent) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *ObserverEvent) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *ObserverEvent) SetId(v string)`

SetId sets Id field to given value.

### HasId

`func (o *ObserverEvent) HasId() bool`

HasId returns a boolean if a field has been set.

### GetEventType

`func (o *ObserverEvent) GetEventType() string`

GetEventType returns the EventType field if non-nil, zero value otherwise.

### GetEventTypeOk

`func (o *ObserverEvent) GetEventTypeOk() (*string, bool)`

GetEventTypeOk returns a tuple with the EventType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEventType

`func (o *ObserverEvent) SetEventType(v string)`

SetEventType sets EventType field to given value.

### HasEventType

`func (o *ObserverEvent) HasEventType() bool`

HasEventType returns a boolean if a field has been set.

### GetAgentId

`func (o *ObserverEvent) GetAgentId() string`

GetAgentId returns the AgentId field if non-nil, zero value otherwise.

### GetAgentIdOk

`func (o *ObserverEvent) GetAgentIdOk() (*string, bool)`

GetAgentIdOk returns a tuple with the AgentId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAgentId

`func (o *ObserverEvent) SetAgentId(v string)`

SetAgentId sets AgentId field to given value.

### HasAgentId

`func (o *ObserverEvent) HasAgentId() bool`

HasAgentId returns a boolean if a field has been set.

### GetSeverity

`func (o *ObserverEvent) GetSeverity() string`

GetSeverity returns the Severity field if non-nil, zero value otherwise.

### GetSeverityOk

`func (o *ObserverEvent) GetSeverityOk() (*string, bool)`

GetSeverityOk returns a tuple with the Severity field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSeverity

`func (o *ObserverEvent) SetSeverity(v string)`

SetSeverity sets Severity field to given value.

### HasSeverity

`func (o *ObserverEvent) HasSeverity() bool`

HasSeverity returns a boolean if a field has been set.

### GetData

`func (o *ObserverEvent) GetData() map[string]interface{}`

GetData returns the Data field if non-nil, zero value otherwise.

### GetDataOk

`func (o *ObserverEvent) GetDataOk() (*map[string]interface{}, bool)`

GetDataOk returns a tuple with the Data field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetData

`func (o *ObserverEvent) SetData(v map[string]interface{})`

SetData sets Data field to given value.

### HasData

`func (o *ObserverEvent) HasData() bool`

HasData returns a boolean if a field has been set.

### GetHash

`func (o *ObserverEvent) GetHash() string`

GetHash returns the Hash field if non-nil, zero value otherwise.

### GetHashOk

`func (o *ObserverEvent) GetHashOk() (*string, bool)`

GetHashOk returns a tuple with the Hash field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetHash

`func (o *ObserverEvent) SetHash(v string)`

SetHash sets Hash field to given value.

### HasHash

`func (o *ObserverEvent) HasHash() bool`

HasHash returns a boolean if a field has been set.

### GetTimestamp

`func (o *ObserverEvent) GetTimestamp() time.Time`

GetTimestamp returns the Timestamp field if non-nil, zero value otherwise.

### GetTimestampOk

`func (o *ObserverEvent) GetTimestampOk() (*time.Time, bool)`

GetTimestampOk returns a tuple with the Timestamp field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTimestamp

`func (o *ObserverEvent) SetTimestamp(v time.Time)`

SetTimestamp sets Timestamp field to given value.

### HasTimestamp

`func (o *ObserverEvent) HasTimestamp() bool`

HasTimestamp returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


