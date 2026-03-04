# TrustHistory

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | Pointer to **string** |  | [optional] 
**AgentId** | Pointer to **string** |  | [optional] 
**PreviousScore** | Pointer to **int32** |  | [optional] 
**NewScore** | Pointer to **int32** |  | [optional] 
**ChangeAmount** | Pointer to **int32** |  | [optional] 
**PreviousTier** | Pointer to **string** |  | [optional] 
**NewTier** | Pointer to **string** |  | [optional] 
**Reason** | Pointer to **string** |  | [optional] 
**Category** | Pointer to **string** |  | [optional] 
**RecordedAt** | Pointer to **time.Time** |  | [optional] 

## Methods

### NewTrustHistory

`func NewTrustHistory() *TrustHistory`

NewTrustHistory instantiates a new TrustHistory object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewTrustHistoryWithDefaults

`func NewTrustHistoryWithDefaults() *TrustHistory`

NewTrustHistoryWithDefaults instantiates a new TrustHistory object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *TrustHistory) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *TrustHistory) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *TrustHistory) SetId(v string)`

SetId sets Id field to given value.

### HasId

`func (o *TrustHistory) HasId() bool`

HasId returns a boolean if a field has been set.

### GetAgentId

`func (o *TrustHistory) GetAgentId() string`

GetAgentId returns the AgentId field if non-nil, zero value otherwise.

### GetAgentIdOk

`func (o *TrustHistory) GetAgentIdOk() (*string, bool)`

GetAgentIdOk returns a tuple with the AgentId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAgentId

`func (o *TrustHistory) SetAgentId(v string)`

SetAgentId sets AgentId field to given value.

### HasAgentId

`func (o *TrustHistory) HasAgentId() bool`

HasAgentId returns a boolean if a field has been set.

### GetPreviousScore

`func (o *TrustHistory) GetPreviousScore() int32`

GetPreviousScore returns the PreviousScore field if non-nil, zero value otherwise.

### GetPreviousScoreOk

`func (o *TrustHistory) GetPreviousScoreOk() (*int32, bool)`

GetPreviousScoreOk returns a tuple with the PreviousScore field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPreviousScore

`func (o *TrustHistory) SetPreviousScore(v int32)`

SetPreviousScore sets PreviousScore field to given value.

### HasPreviousScore

`func (o *TrustHistory) HasPreviousScore() bool`

HasPreviousScore returns a boolean if a field has been set.

### GetNewScore

`func (o *TrustHistory) GetNewScore() int32`

GetNewScore returns the NewScore field if non-nil, zero value otherwise.

### GetNewScoreOk

`func (o *TrustHistory) GetNewScoreOk() (*int32, bool)`

GetNewScoreOk returns a tuple with the NewScore field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetNewScore

`func (o *TrustHistory) SetNewScore(v int32)`

SetNewScore sets NewScore field to given value.

### HasNewScore

`func (o *TrustHistory) HasNewScore() bool`

HasNewScore returns a boolean if a field has been set.

### GetChangeAmount

`func (o *TrustHistory) GetChangeAmount() int32`

GetChangeAmount returns the ChangeAmount field if non-nil, zero value otherwise.

### GetChangeAmountOk

`func (o *TrustHistory) GetChangeAmountOk() (*int32, bool)`

GetChangeAmountOk returns a tuple with the ChangeAmount field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetChangeAmount

`func (o *TrustHistory) SetChangeAmount(v int32)`

SetChangeAmount sets ChangeAmount field to given value.

### HasChangeAmount

`func (o *TrustHistory) HasChangeAmount() bool`

HasChangeAmount returns a boolean if a field has been set.

### GetPreviousTier

`func (o *TrustHistory) GetPreviousTier() string`

GetPreviousTier returns the PreviousTier field if non-nil, zero value otherwise.

### GetPreviousTierOk

`func (o *TrustHistory) GetPreviousTierOk() (*string, bool)`

GetPreviousTierOk returns a tuple with the PreviousTier field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPreviousTier

`func (o *TrustHistory) SetPreviousTier(v string)`

SetPreviousTier sets PreviousTier field to given value.

### HasPreviousTier

`func (o *TrustHistory) HasPreviousTier() bool`

HasPreviousTier returns a boolean if a field has been set.

### GetNewTier

`func (o *TrustHistory) GetNewTier() string`

GetNewTier returns the NewTier field if non-nil, zero value otherwise.

### GetNewTierOk

`func (o *TrustHistory) GetNewTierOk() (*string, bool)`

GetNewTierOk returns a tuple with the NewTier field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetNewTier

`func (o *TrustHistory) SetNewTier(v string)`

SetNewTier sets NewTier field to given value.

### HasNewTier

`func (o *TrustHistory) HasNewTier() bool`

HasNewTier returns a boolean if a field has been set.

### GetReason

`func (o *TrustHistory) GetReason() string`

GetReason returns the Reason field if non-nil, zero value otherwise.

### GetReasonOk

`func (o *TrustHistory) GetReasonOk() (*string, bool)`

GetReasonOk returns a tuple with the Reason field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetReason

`func (o *TrustHistory) SetReason(v string)`

SetReason sets Reason field to given value.

### HasReason

`func (o *TrustHistory) HasReason() bool`

HasReason returns a boolean if a field has been set.

### GetCategory

`func (o *TrustHistory) GetCategory() string`

GetCategory returns the Category field if non-nil, zero value otherwise.

### GetCategoryOk

`func (o *TrustHistory) GetCategoryOk() (*string, bool)`

GetCategoryOk returns a tuple with the Category field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCategory

`func (o *TrustHistory) SetCategory(v string)`

SetCategory sets Category field to given value.

### HasCategory

`func (o *TrustHistory) HasCategory() bool`

HasCategory returns a boolean if a field has been set.

### GetRecordedAt

`func (o *TrustHistory) GetRecordedAt() time.Time`

GetRecordedAt returns the RecordedAt field if non-nil, zero value otherwise.

### GetRecordedAtOk

`func (o *TrustHistory) GetRecordedAtOk() (*time.Time, bool)`

GetRecordedAtOk returns a tuple with the RecordedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRecordedAt

`func (o *TrustHistory) SetRecordedAt(v time.Time)`

SetRecordedAt sets RecordedAt field to given value.

### HasRecordedAt

`func (o *TrustHistory) HasRecordedAt() bool`

HasRecordedAt returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


