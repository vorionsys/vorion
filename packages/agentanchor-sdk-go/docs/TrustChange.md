# TrustChange

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**AgentId** | **string** |  | 
**ChangeAmount** | **int32** | Amount to adjust trust score | 
**Reason** | **string** | Human-readable reason for change | 
**Category** | **string** | Category of trust change | 
**ReferenceId** | Pointer to **string** | Optional reference to related record | [optional] 

## Methods

### NewTrustChange

`func NewTrustChange(agentId string, changeAmount int32, reason string, category string, ) *TrustChange`

NewTrustChange instantiates a new TrustChange object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewTrustChangeWithDefaults

`func NewTrustChangeWithDefaults() *TrustChange`

NewTrustChangeWithDefaults instantiates a new TrustChange object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetAgentId

`func (o *TrustChange) GetAgentId() string`

GetAgentId returns the AgentId field if non-nil, zero value otherwise.

### GetAgentIdOk

`func (o *TrustChange) GetAgentIdOk() (*string, bool)`

GetAgentIdOk returns a tuple with the AgentId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAgentId

`func (o *TrustChange) SetAgentId(v string)`

SetAgentId sets AgentId field to given value.


### GetChangeAmount

`func (o *TrustChange) GetChangeAmount() int32`

GetChangeAmount returns the ChangeAmount field if non-nil, zero value otherwise.

### GetChangeAmountOk

`func (o *TrustChange) GetChangeAmountOk() (*int32, bool)`

GetChangeAmountOk returns a tuple with the ChangeAmount field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetChangeAmount

`func (o *TrustChange) SetChangeAmount(v int32)`

SetChangeAmount sets ChangeAmount field to given value.


### GetReason

`func (o *TrustChange) GetReason() string`

GetReason returns the Reason field if non-nil, zero value otherwise.

### GetReasonOk

`func (o *TrustChange) GetReasonOk() (*string, bool)`

GetReasonOk returns a tuple with the Reason field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetReason

`func (o *TrustChange) SetReason(v string)`

SetReason sets Reason field to given value.


### GetCategory

`func (o *TrustChange) GetCategory() string`

GetCategory returns the Category field if non-nil, zero value otherwise.

### GetCategoryOk

`func (o *TrustChange) GetCategoryOk() (*string, bool)`

GetCategoryOk returns a tuple with the Category field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCategory

`func (o *TrustChange) SetCategory(v string)`

SetCategory sets Category field to given value.


### GetReferenceId

`func (o *TrustChange) GetReferenceId() string`

GetReferenceId returns the ReferenceId field if non-nil, zero value otherwise.

### GetReferenceIdOk

`func (o *TrustChange) GetReferenceIdOk() (*string, bool)`

GetReferenceIdOk returns a tuple with the ReferenceId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetReferenceId

`func (o *TrustChange) SetReferenceId(v string)`

SetReferenceId sets ReferenceId field to given value.

### HasReferenceId

`func (o *TrustChange) HasReferenceId() bool`

HasReferenceId returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


